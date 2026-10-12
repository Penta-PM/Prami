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
import type { ChatReplyOut, ChatRuntime, ChatSettings } from '@/server/chat/graph/types';
import { createOpenAIChatModel } from '@/server/llm/vendors/openai-chat';

import { createOpenAIStub, type VendorTurn } from '../../fixtures/chat/vendor-http';
import {
  ask,
  RETRY_SAFE_SETTINGS,
  scriptedRuntime,
  setupChatDb,
  type ChatTestDb,
} from '../../helpers/chat';

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

async function runtimeWith(
  turn: VendorTurn,
  settings?: Partial<ChatSettings>,
): Promise<ChatRuntime> {
  const stub = createOpenAIStub([turn]);
  const runtime = scriptedRuntime(ctx.handle, {
    status: 'ready',
    vendor: 'openai',
    modelId: 'gpt-6.1-sol',
    settings,
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

async function sseReply(runtime: ChatRuntime): Promise<ChatReplyOut> {
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
  return JSON.parse(/event: final\ndata: (.*)/.exec(raw)![1]!) as ChatReplyOut;
}

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

  it.each(['json', 'sse'] as const)(
    '%s: 잘린 응답의 도구 호출은 실행하지 않는다 (incomplete + function_call → 도구 0·요청 1회·빈 답 안내)',
    async (path) => {
      const logs = captureLlmErrors();
      const stub = createOpenAIStub([
        {
          incomplete: {
            reason: 'max_output_tokens',
            toolCall: { name: 'price_lookup', args: { query: 'Wapples-500', family: null } },
          },
        },
        { text: 'SHOULD-NOT-BE-CALLED' },
      ]);
      const runtime = await runtimeWith({ text: 'unused' });
      const credential = await runtime.resolveCredential();
      runtime.resolveCredential = async () => ({
        ...credential,
        createModel: (options) =>
          createOpenAIChatModel(KEY, 'gpt-6.1-sol', { ...options, fetch: stub.fetch }),
      });
      const reply =
        path === 'json' ? await ask(runtime, 'Wapples-500 가격') : await sseReply(runtime);
      expect(stub.requests).toHaveLength(1);
      expect(reply).toMatchObject({ mode: 'llm', reply: EMPTY_LLM_REPLY, candidates: [] });
      expect(logs()[0]).toMatchObject({ vendorErrorType: 'incomplete_max_output_tokens' });
    },
  );

  it('재시도 후 성공한 응답의 attempts 는 실패 + 1 (500 → incomplete)', async () => {
    const logs = captureLlmErrors();
    const stub = createOpenAIStub([
      { error: { status: 500, body: { error: { type: 'server_error' } } } },
      { incomplete: { reason: 'max_output_tokens', text: PARTIAL } },
    ]);
    // 500 → 재시도(1~2s 지터) — 기본 timeoutMs 2000 과의 경합 방지
    const runtime = await runtimeWith({ text: 'unused' }, RETRY_SAFE_SETTINGS);
    const credential = await runtime.resolveCredential();
    runtime.resolveCredential = async () => ({
      ...credential,
      createModel: (options) =>
        createOpenAIChatModel(KEY, 'gpt-6.1-sol', { ...options, fetch: stub.fetch }),
    });
    const reply = await ask(runtime, 'Wapples-500 가격');
    expect(reply.reply).toBe(PARTIAL);
    expect(stub.requests).toHaveLength(2);
    expect(logs()[0]).toMatchObject({
      vendorErrorType: 'incomplete_max_output_tokens',
      attempts: 2,
    });
  }, 20_000);

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
    [
      'Anthropic stop_reason max_tokens + 텍스트',
      { content: 'abc', response_metadata: { stop_reason: 'max_tokens' } },
      'truncated',
    ],
    [
      'Anthropic 스트리밍 kwargs max_tokens, 텍스트 없음',
      { content: '', additional_kwargs: { stop_reason: 'max_tokens' } },
      'empty',
    ],
    [
      'Gemini finishReason MAX_TOKENS + 텍스트',
      { content: 'abc', response_metadata: { finishReason: 'MAX_TOKENS' } },
      'truncated',
    ],
    [
      'Chat Completions(OpenRouter) finish_reason length + 텍스트 (AC-372 선택)',
      { content: 'abc', response_metadata: { finish_reason: 'length' } },
      'truncated',
    ],
    [
      'Chat Completions finish_reason stop 은 정상',
      { content: 'abc', response_metadata: { finish_reason: 'stop' } },
      'answer',
    ],
    [
      'incomplete + 도구 호출(텍스트 없음) → 실행 안 함',
      {
        content: '',
        tool_calls: [{ id: 'c1', name: 'price_lookup', args: {} }],
        response_metadata: {
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        },
      },
      'empty',
    ],
    ['사고 블록만', { content: [{ type: 'thinking', thinking: 't' }] }, 'empty'],
  ] as const)('%s', (_label, fields, outcome) => {
    expect(classifyResponse(new AIMessage(fields as never)).outcome).toBe(outcome);
  });
});
