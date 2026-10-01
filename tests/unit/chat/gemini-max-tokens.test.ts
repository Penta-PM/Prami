// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import { EMPTY_LLM_REPLY, TRUNCATED_OUTPUT_NOTICE } from '@/server/chat/graph/messages';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatReplyOut, ChatRuntime } from '@/server/chat/graph/types';
import { createGoogleChatModel } from '@/server/llm/vendors/google-chat';

import { createGeminiStub, type VendorTurn } from '../../fixtures/chat/vendor-http';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * AC-370 (PRAMI-003 §4.5.5 L-1 r3, PR #20 L-a): Gemini `finishReason:'MAX_TOKENS'` 를 SSE(스트리밍) 경로에서도 JSON 과 같게
 * 판정한다 — 텍스트 + notice `truncated_output` + `chat.llm_error`(source response, incomplete_max_output_tokens) 1행,
 * 텍스트가 없으면 두 경로 모두 빈 답 안내. 실제 Gemini 어댑터 + 전역 fetch 스텁(실벤더 호출 0).
 */
const KEY = 'AIzaTestMAXTOKENSgoogle000000000000000001';
const PARTIAL = 'Wapples-500 판매가는 두 모델입니다. 나머지 설명은';

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function captureLlmErrors() {
  const lines: string[] = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
  }
  return () =>
    lines
      .filter((line) => line.includes('"event":"chat.llm_error"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function geminiRuntime(turn: VendorTurn): Promise<ChatRuntime> {
  vi.stubGlobal('fetch', createGeminiStub([turn]).fetch);
  const runtime = scriptedRuntime(ctx.handle, {
    status: 'ready',
    vendor: 'google',
    modelId: 'gemini-3.8-flash',
  });
  const credential = await runtime.resolveCredential();
  runtime.resolveCredential = async () => ({
    ...credential,
    createModel: (options) => createGoogleChatModel(KEY, 'gemini-3.8-flash', options),
  });
  return runtime;
}

async function sse(runtime: ChatRuntime): Promise<ChatReplyOut> {
  const input = {
    text: 'Wapples-500 가격',
    truncated: false,
    history: [],
    actor: { userId: ctx.userId, role: 'USER' as const },
  };
  const raw = await new Response(streamChat(buildChatGraph(), input, runtime)).text();
  return JSON.parse(/event: final\ndata: (.*)/.exec(raw)![1]!) as ChatReplyOut;
}

const truncated = (text: string): VendorTurn => ({
  incomplete: { reason: 'max_output_tokens', text },
});

describe('AC-370 Gemini MAX_TOKENS — JSON·SSE 같은 판정', () => {
  it.each(['json', 'sse'] as const)(
    '%s: 부분 텍스트 + notice truncated_output + chat.llm_error 1행',
    async (path) => {
      const logs = captureLlmErrors();
      const runtime = await geminiRuntime(truncated(PARTIAL));
      const reply = path === 'json' ? await ask(runtime, 'Wapples-500 가격') : await sse(runtime);
      expect(reply.mode).toBe('llm');
      expect(reply.reply).toContain('Wapples-500 판매가는 두 모델입니다.');
      expect(reply.notice).toContain(TRUNCATED_OUTPUT_NOTICE);
      const lines = logs();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        source: 'response',
        httpStatus: 200,
        vendorErrorType: 'incomplete_max_output_tokens',
        vendor: 'google',
        stream: path === 'sse',
      });
    },
  );

  it.each(['json', 'sse'] as const)('%s: 텍스트 없음 → 빈 답 안내', async (path) => {
    const logs = captureLlmErrors();
    const runtime = await geminiRuntime(truncated(''));
    const reply = path === 'json' ? await ask(runtime, 'Wapples-500 가격') : await sse(runtime);
    expect(reply.reply).toBe(EMPTY_LLM_REPLY);
    expect(reply.notice ?? '').not.toContain(TRUNCATED_OUTPUT_NOTICE);
    expect(logs()[0]).toMatchObject({ vendorErrorType: 'incomplete_max_output_tokens' });
  });

  it.each(['json', 'sse'] as const)('%s: 정상 종료(STOP)는 판정 없음', async (path) => {
    const logs = captureLlmErrors();
    const runtime = await geminiRuntime({ text: 'Wapples-500 은 두 모델이 있습니다.' });
    const reply = path === 'json' ? await ask(runtime, 'Wapples-500 가격') : await sse(runtime);
    expect(reply).toMatchObject({ mode: 'llm', reply: 'Wapples-500 은 두 모델이 있습니다.' });
    expect(reply.notice ?? '').not.toContain(TRUNCATED_OUTPUT_NOTICE);
    expect(logs()).toHaveLength(0);
  });
});
