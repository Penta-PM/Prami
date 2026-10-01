// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import { LLM_ERROR_NOTICE } from '@/server/chat/graph/messages';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatReplyOut, ChatRuntime } from '@/server/chat/graph/types';
import { describeLlmError } from '@/server/llm/error-diagnostics';
import { normalizeLlmError } from '@/server/llm/errors';
import { createOpenAICompatibleChatModel } from '@/server/llm/vendors/openai-chat';

import { OPENAI_TOOLS_REASONING_400 } from '../../fixtures/chat/openai-errors';
import { createOpenAIStub } from '../../fixtures/chat/vendor-http';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { expectNoSecret } from '../../helpers/secret';

/**
 * PRAMI-003 회귀: 실제 실패 응답(OpenAI 400 invalid_request_error · param reasoning_effort, 비밀값 제거)을 고정해
 * ① §4.8.3 분류 = request_rejected (예전엔 llm_error 로 뭉개짐) ② chat.llm_error 진단 필드(HTTP 상태·type·param·요청 ID·
 * 어댑터 버전·스트리밍 여부)가 남고 키·메시지·사용자 질문은 없음 ③ 규칙 폴백 + 안내 — 비스트리밍·스트리밍 둘 다.
 * 400 을 실제로 내던 Chat Completions 요청은 OpenAI 호환 팩토리(OpenRouter 경로)로 재현한다.
 */
const KEY = 'sk-proj-test-PRAMI003-diagnostics-000000000001';
const QUESTION = 'PRAMI003-QUESTION-MARKER Wapples-500 가격';

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});
afterEach(() => vi.restoreAllMocks());

async function failingRuntime(): Promise<ChatRuntime> {
  const stub = createOpenAIStub([{ error: OPENAI_TOOLS_REASONING_400 }]);
  const runtime = scriptedRuntime(ctx.handle, {
    status: 'ready',
    vendor: 'openai',
    modelId: 'gpt-6-luna',
  });
  const credential = await runtime.resolveCredential();
  runtime.resolveCredential = async () => ({
    ...credential,
    createModel: (options) =>
      createOpenAICompatibleChatModel(
        KEY,
        'gpt-6-luna',
        { ...options, fetch: stub.fetch },
        'https://api.openai.com/v1',
      ),
  });
  return runtime;
}

function captureWarnings() {
  const lines: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return () => lines.filter((line) => line.includes('chat.llm_error'));
}

function expectDiagnostics(line: string | undefined, streaming: boolean) {
  expect(line).toBeDefined();
  const entry = JSON.parse(line!) as Record<string, unknown>;
  expect(entry).toMatchObject({
    event: 'chat.llm_error',
    code: 'request_rejected',
    vendor: 'openai',
    model: 'gpt-6-luna',
    adapter: '@langchain/openai@1.6.0',
    streaming,
    source: 'http',
    status: 400,
    errorType: 'invalid_request_error',
    errorParam: 'reasoning_effort',
    requestId: 'req_fixture_prami003',
  });
  expectNoSecret(line!, KEY, 'chat.llm_error 로그');
  expect(line).not.toContain('FIXTURE-MESSAGE');
  expect(line).not.toContain('PRAMI003-QUESTION');
  expect(entry).not.toHaveProperty('message');
}

describe('PRAMI-003 벤더 거부 진단 (§4.8.3 보강)', () => {
  it('분류: 400 invalid_request_error → request_rejected, 진단 필드는 식별자만', () => {
    const error = Object.assign(new Error('400 FIXTURE-MESSAGE sk-proj-should-not-appear'), {
      status: 400,
      type: 'invalid_request_error',
      param: 'reasoning_effort',
      code: null,
      requestID: 'req_fixture_prami003',
      error: OPENAI_TOOLS_REASONING_400.body.error,
    });
    expect(normalizeLlmError(error)).toBe('request_rejected');
    const diagnostics = describeLlmError(error);
    expect(diagnostics).toEqual({
      source: 'http',
      status: 400,
      errorType: 'invalid_request_error',
      errorParam: 'reasoning_effort',
      requestId: 'req_fixture_prami003',
      errorName: 'Error',
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/FIXTURE|sk-proj/);
  });

  it('분류 경계: 컨텍스트 초과 400 은 too_long, 422 도 request_rejected, 로컬 예외는 llm_error + 프레임 이름', () => {
    expect(normalizeLlmError({ status: 400, lc_error_code: 'CONTEXT_OVERFLOW' })).toBe('too_long');
    expect(normalizeLlmError({ status: 422 })).toBe('request_rejected');
    const local = (function convertTools() {
      return new TypeError('local failure');
    })();
    expect(normalizeLlmError(local)).toBe('llm_error');
    expect(describeLlmError(local)).toMatchObject({
      source: 'local',
      errorName: 'TypeError',
      frame: 'convertTools',
    });
  });

  it('비스트리밍: 규칙 폴백 + 안내, chat.llm_error 진단 필드 (streaming:false)', async () => {
    const warnings = captureWarnings();
    const reply = await ask(await failingRuntime(), QUESTION);
    expect(reply.mode).toBe('rule');
    expect(reply.notice).toContain(LLM_ERROR_NOTICE);
    expectDiagnostics(warnings()[0], false);
  });

  it('스트리밍: final 은 규칙 답 + 안내, 진단 필드 (streaming:true), SSE 에 키·벤더 원문 없음', async () => {
    const warnings = captureWarnings();
    const input = {
      text: QUESTION,
      truncated: false,
      history: [],
      actor: { userId: ctx.userId, role: 'USER' as const },
    };
    const raw = await new Response(
      streamChat(buildChatGraph(), input, await failingRuntime()),
    ).text();
    const final = JSON.parse(/event: final\ndata: (.*)/.exec(raw)![1]!) as ChatReplyOut;
    expect(final.mode).toBe('rule');
    expect(final.notice).toContain(LLM_ERROR_NOTICE);
    expectNoSecret(raw, KEY, 'SSE');
    expect(raw).not.toContain('FIXTURE-MESSAGE');
    expectDiagnostics(warnings()[0], true);
  });
});
