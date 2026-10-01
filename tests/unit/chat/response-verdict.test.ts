// @vitest-environment node
import { AIMessage } from '@langchain/core/messages';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import {
  EMPTY_LLM_REPLY,
  REFUSED_REPLY,
  TRUNCATED_OUTPUT_NOTICE,
} from '@/server/chat/graph/messages';
import { classifyResponse } from '@/server/chat/graph/refusal';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatReplyOut, ChatRuntime } from '@/server/chat/graph/types';
import { createOpenAIChatModel } from '@/server/llm/vendors/openai-chat';

import { createOpenAIStub, type VendorTurn } from '../../fixtures/chat/vendor-http';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * AC-353 응답 판정 (PRAMI-003 §4.5.5 L-1) — 실제 OpenAI Responses 어댑터 + 전송 스텁, JSON·SSE 각각.
 * ① refusal 콘텐츠 → 거부 문구, 거부 원문 0 ② incomplete/max_output_tokens + 부분 텍스트 → 텍스트 + notice truncated_output
 * ③ incomplete/max_output_tokens + 텍스트 없음 → 빈 답 안내 ④ incomplete/content_filter → 거부 문구 ⑤ 빈 출력 → 빈 답 안내.
 * 모두 `chat.llm_error` warn 1행 (source response, httpStatus 200, vendorErrorType = 판정 토큰).
 */
const KEY = 'sk-proj-test-VERDICT-openai-00000000000000001';
const REFUSAL_TEXT = 'VERDICT-REFUSAL-ORIGINAL 거부 사유 원문';
const PARTIAL = 'Wapples-500 판매가는 확인 중입니다';
/** 문장 하나가 끝나야 토큰 가드가 내보낸다 — 거부 판정 전에 토큰이 나간 경우(discard) 재현 */
const PARTIAL_SENTENCE = 'Wapples-500 판매가는 두 모델입니다. 나머지 설명은';

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});
afterEach(() => vi.restoreAllMocks());

async function runtimeWith(turn: VendorTurn): Promise<ChatRuntime> {
  const stub = createOpenAIStub([turn]);
  const runtime = scriptedRuntime(ctx.handle, {
    status: 'ready',
    vendor: 'openai',
    modelId: 'gpt-6.1-sol',
  });
  const credential = await runtime.resolveCredential();
  runtime.resolveCredential = async () => ({
    ...credential,
    createModel: (options) =>
      createOpenAIChatModel(KEY, 'gpt-6.1-sol', { ...options, fetch: stub.fetch }),
  });
  return runtime;
}

function captureLlmErrors() {
  const lines: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return () =>
    lines
      .filter((line) => line.includes('"event":"chat.llm_error"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
}

type Run = { reply: ChatReplyOut; raw: string; events: string[] };

async function run(path: 'json' | 'sse', turn: VendorTurn): Promise<Run> {
  const runtime = await runtimeWith(turn);
  if (path === 'json') {
    const reply = await ask(runtime, 'Wapples-500 가격');
    return { reply, raw: JSON.stringify(reply), events: [] };
  }
  const raw = await new Response(
    streamChat(
      buildChatGraph(),
      {
        text: 'Wapples-500 가격',
        truncated: false,
        history: [],
        actor: { userId: ctx.userId, role: 'USER' },
      },
      runtime,
    ),
  ).text();
  const events = [...raw.matchAll(/^event: (.+)$/gm)].map((match) => match[1]!);
  const reply = JSON.parse(/event: final\ndata: (.*)/.exec(raw)![1]!) as ChatReplyOut;
  return { reply, raw, events };
}

const CASES: [string, VendorTurn, string, (result: Run) => void][] = [
  [
    '① refusal 콘텐츠',
    { refusal: REFUSAL_TEXT },
    'refusal',
    ({ reply, raw }) => {
      expect(reply).toMatchObject({ mode: 'refusal', reply: REFUSED_REPLY });
      expect(raw).not.toContain('VERDICT-REFUSAL-ORIGINAL');
    },
  ],
  [
    '② incomplete max_output_tokens + 부분 텍스트',
    { incomplete: { reason: 'max_output_tokens', text: PARTIAL } },
    'incomplete_max_output_tokens',
    ({ reply }) => {
      expect(reply).toMatchObject({ mode: 'llm', reply: PARTIAL });
      expect(reply.notice).toContain(TRUNCATED_OUTPUT_NOTICE);
    },
  ],
  [
    '③ incomplete max_output_tokens + 텍스트 없음',
    { incomplete: { reason: 'max_output_tokens' } },
    'incomplete_max_output_tokens',
    ({ reply }) => {
      expect(reply).toMatchObject({ mode: 'llm', reply: EMPTY_LLM_REPLY });
      expect(reply.notice ?? '').not.toContain(TRUNCATED_OUTPUT_NOTICE);
    },
  ],
  [
    '④ incomplete content_filter (부분 텍스트 있음)',
    { incomplete: { reason: 'content_filter', text: PARTIAL_SENTENCE } },
    'incomplete_content_filter',
    ({ reply, events }) => {
      expect(reply).toMatchObject({ mode: 'refusal', reply: REFUSED_REPLY });
      // SSE: 부분 텍스트가 토큰으로 나간 뒤 판정 → discard 1회 (AC-247 계약)
      if (events.length > 0) {
        expect(events).toContain('token');
        expect(events.filter((name) => name === 'discard')).toHaveLength(1);
      }
    },
  ],
  [
    '⑤ 빈 출력',
    { text: '' },
    'empty_output',
    ({ reply }) => {
      expect(reply).toMatchObject({ mode: 'llm', reply: EMPTY_LLM_REPLY });
    },
  ],
];

describe('AC-353 응답 판정 — OpenAI Responses JSON·SSE (L-1)', () => {
  for (const path of ['json', 'sse'] as const) {
    it.each(CASES)(`${path}: %s`, async (_label, turn, issue, check) => {
      const logs = captureLlmErrors();
      const result = await run(path, turn);
      check(result);
      const lines = logs();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'warn',
        source: 'response',
        httpStatus: 200,
        vendorErrorType: issue,
        vendor: 'openai',
        stream: path === 'sse',
        attempts: 1,
      });
      expect(JSON.stringify(lines[0])).not.toMatch(/VERDICT-REFUSAL|판매가는|나머지 설명/);
    });
  }

  it('정상 응답은 진단 로그 0', async () => {
    const logs = captureLlmErrors();
    const result = await run('sse', { text: 'Wapples-500 은 두 모델이 있습니다.' });
    expect(result.reply.mode).toBe('llm');
    expect(logs()).toHaveLength(0);
  });
});

describe('classifyResponse 표 (메타데이터만)', () => {
  it.each([
    [
      'Anthropic stop_reason refusal',
      { content: 'x', response_metadata: { stop_reason: 'refusal' } },
      'refused',
    ],
    [
      '도구 호출만 (텍스트 없음)',
      { content: '', tool_calls: [{ id: 'c1', name: 'price_lookup', args: {} }] },
      'answer',
    ],
    [
      'incomplete 사유 미상 + 텍스트',
      {
        content: 'abc',
        response_metadata: { status: 'incomplete', incomplete_details: { reason: 'x' } },
      },
      'truncated',
    ],
    ['공백뿐인 텍스트', { content: '   ' }, 'empty'],
    ['사고 블록만', { content: [{ type: 'thinking', thinking: 't' }] }, 'empty'],
  ] as const)('%s', (_label, fields, outcome) => {
    expect(classifyResponse(new AIMessage(fields as never)).outcome).toBe(outcome);
  });
});
