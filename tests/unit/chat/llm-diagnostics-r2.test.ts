// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatRuntime } from '@/server/chat/graph/types';
import { debugMessageOf, describeLlmError, OTHER_TOKEN } from '@/server/llm/error-diagnostics';
import { createOpenAIChatModel } from '@/server/llm/vendors/openai-chat';

import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';
import { createOpenAIStub, type VendorTurn } from '../../fixtures/chat/vendor-http';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { expectNoSecret } from '../../helpers/secret';

/**
 * PRAMI-003 §4.5.1 r2 진단 필드 최종 계약 (QA M-1) + §4.5.5 L-4 정확도.
 * AC-352: `chat.llm_error` 키 집합 = 표, PR #18 이름 없음, `requestId` = 앱 요청 id, 허용 목록 밖 → `other`, param 생략.
 * AC-354 ③④: 앱 타임아웃 `source='timeout'` / 클라이언트 중단 `source='abort'` + `chat.llm_aborted` info,
 * LangChain 래핑 오류의 `sdkErrorName` = SDK 클래스(cause 체인).
 */
const KEY = 'sk-proj-test-R2DIAG-openai-0000000000000001';
const APP_REQUEST_ID = 'app-req-0000-r2diag';

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

type Line = Record<string, unknown>;

function captureLogs() {
  const lines: { level: string; text: string }[] = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push({ level, text: args.map(String).join(' ') });
    });
  }
  return (event: string): Line[] =>
    lines
      .filter((line) => line.text.includes(`"event":"${event}"`))
      .map((line) => JSON.parse(line.text) as Line);
}

async function openAiRuntime(turns: VendorTurn[], requestId?: string): Promise<ChatRuntime> {
  const stub = createOpenAIStub(turns);
  const runtime = scriptedRuntime(ctx.handle, {
    status: 'ready',
    vendor: 'openai',
    modelId: 'gpt-6.1-sol',
  });
  runtime.requestId = requestId;
  const credential = await runtime.resolveCredential();
  runtime.resolveCredential = async () => ({
    ...credential,
    createModel: (options) =>
      createOpenAIChatModel(KEY, 'gpt-6.1-sol', { ...options, fetch: stub.fetch }),
  });
  return runtime;
}

const REJECTED_400: VendorTurn = {
  error: {
    status: 400,
    headers: { 'x-request-id': 'req_vendor_r2diag' },
    body: {
      error: {
        message: 'R2-VENDOR-MESSAGE must not be logged',
        type: 'invalid_request_error',
        code: 'unsupported_parameter',
        param: 'reasoning.effort',
      },
    },
  },
};

describe('AC-352 진단 필드 이름 (§4.5.1 r2)', () => {
  it('키 집합 스냅샷: §4.5.1 표와 같고 PR #18 이름이 없으며 requestId = 앱 요청 id, 벤더 요청 id 는 vendorRequestId', async () => {
    const logs = captureLogs();
    const reply = await ask(await openAiRuntime([REJECTED_400], APP_REQUEST_ID), 'Wapples-500');
    expect(reply.mode).toBe('rule');
    const [entry] = logs('chat.llm_error');
    expect(Object.keys(entry!).sort()).toEqual(
      [
        'adapter',
        'attempts',
        'code',
        'event',
        'httpStatus',
        'latencyMs',
        'level',
        'model',
        'requestId',
        'sdkErrorName',
        'source',
        'stream',
        'time',
        'vendor',
        'vendorErrorCode',
        'vendorErrorParam',
        'vendorErrorType',
        'vendorRequestId',
      ].sort(),
    );
    expect(entry).toMatchObject({
      code: 'request_rejected',
      source: 'http',
      httpStatus: 400,
      vendorErrorType: 'invalid_request_error',
      vendorErrorCode: 'unsupported_parameter',
      vendorErrorParam: 'reasoning.effort',
      vendorRequestId: 'req_vendor_r2diag',
      requestId: APP_REQUEST_ID,
      sdkErrorName: 'BadRequestError',
      stream: false,
      attempts: 1,
    });
    const text = JSON.stringify(entry);
    expect(text).not.toContain('R2-VENDOR-MESSAGE');
    expectNoSecret(text, KEY, 'chat.llm_error');
  });

  it.each([
    ['키 모양', 'sk-proj-test-INJECTED-abcdefghijklmnopqrstu'],
    ['Bearer 토큰', 'Bearer sk-proj-test-INJECTED-abcdefghij'],
    ['스크립트', '<script>alert(1)</script>'],
    ['공백 포함', 'invalid request error'],
  ])('허용 목록 밖 type·code (%s) → other, 식별자 아닌 param 은 생략', (_label, value) => {
    const diagnostics = describeLlmError({
      status: 400,
      type: value,
      code: value,
      param: value,
      error: { type: value, code: value, param: value },
    });
    expect(diagnostics.vendorErrorType).toBe(OTHER_TOKEN);
    expect(diagnostics.vendorErrorCode).toBe(OTHER_TOKEN);
    expect(diagnostics).not.toHaveProperty('vendorErrorParam');
    expect(JSON.stringify(diagnostics)).not.toContain(value);
  });

  it('목록 밖이어도 식별자 모양이면 type·code 는 other, param(소문자 식별자)은 남는다', () => {
    const value = 'some_new_vendor_code';
    expect(describeLlmError({ status: 400, type: value, code: value, param: value })).toMatchObject(
      { vendorErrorType: OTHER_TOKEN, vendorErrorCode: OTHER_TOKEN, vendorErrorParam: value },
    );
  });

  it('vendorRequestId 형식 밖(65자·기호)은 생략, 헤더 request-id 도 읽는다', () => {
    expect(describeLlmError({ status: 500, requestID: 'x'.repeat(65) })).not.toHaveProperty(
      'vendorRequestId',
    );
    expect(describeLlmError({ status: 500, requestID: 'req id;drop' })).not.toHaveProperty(
      'vendorRequestId',
    );
    expect(
      describeLlmError({ status: 529, headers: new Headers({ 'request-id': 'req_ant_01' }) }),
    ).toMatchObject({ vendorRequestId: 'req_ant_01' });
  });

  it('lcCode 는 허용 목록만, Anthropic 봉투 type(error) 보다 안쪽 overloaded_error 를 고른다', () => {
    expect(describeLlmError({ lc_error_code: 'MODEL_RATE_LIMIT' }).lcCode).toBe('MODEL_RATE_LIMIT');
    expect(describeLlmError({ lc_error_code: 'SOMETHING_ELSE' })).not.toHaveProperty('lcCode');
    expect(
      describeLlmError({
        status: 529,
        error: { type: 'error', error: { type: 'overloaded_error' } },
      }).vendorErrorType,
    ).toBe('overloaded_error');
  });

  it('debugMessage: development 에서만 sanitize 후 120자, test·production 에는 없다', () => {
    const error = new Error(`vendor said ${KEY} ${'x'.repeat(200)}`);
    expect(debugMessageOf(error)).toBeUndefined();
    vi.stubEnv('NODE_ENV', 'production');
    expect(debugMessageOf(error)).toBeUndefined();
    vi.stubEnv('NODE_ENV', 'development');
    const message = debugMessageOf(error)!;
    expect(message.length).toBeLessThanOrEqual(120);
    expect(message).not.toContain(KEY);
    expect(message).toContain('[REDACTED]');
  });
});

describe('L-4 sdkErrorName · source 정확도 (AC-354 ③④)', () => {
  it('LangChain 래핑(name=Error) 이어도 SDK 클래스 이름, cause 체인에서 Error 아닌 첫 이름', () => {
    class APIConnectionError extends Error {}
    const wrapped = Object.assign(new APIConnectionError('Connection error.'), {
      cause: Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('socket'), { code: 'ECONNRESET' }),
      }),
    });
    expect(describeLlmError(wrapped)).toMatchObject({
      source: 'network',
      sdkErrorName: 'APIConnectionError',
    });
    const plain = Object.assign(new Error('outer'), { cause: new RangeError('inner') });
    expect(describeLlmError(plain).sdkErrorName).toBe('RangeError');
  });

  it('앱 타임아웃 → source timeout (chat.llm_error warn)', async () => {
    const logs = captureLogs();
    const model = new ScriptedChatModel([{ delayMs: 5_000 }]);
    await ask(scriptedRuntime(ctx.handle, { model, settings: { timeoutMs: 150 } }), '가격');
    const [entry] = logs('chat.llm_error');
    expect(entry).toMatchObject({ level: 'warn', code: 'unavailable', source: 'timeout' });
    expect(logs('chat.llm_aborted')).toHaveLength(0);
  });

  it('클라이언트 중단(SSE 끊김) → source abort, warn 이 아니라 info chat.llm_aborted', async () => {
    const logs = captureLogs();
    const model = new ScriptedChatModel([{ delayMs: 5_000 }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    await new Response(
      streamChat(
        buildChatGraph(),
        {
          text: '가격',
          truncated: false,
          history: [],
          actor: { userId: ctx.userId, role: 'USER' },
        },
        scriptedRuntime(ctx.handle, { model, settings: { timeoutMs: 10_000 } }),
        controller.signal,
      ),
    ).text();
    const [entry] = logs('chat.llm_aborted');
    expect(entry).toMatchObject({ level: 'info', source: 'abort', stream: true });
    expect(logs('chat.llm_error')).toHaveLength(0);
  });

  it('attempts: 재시도 1회(maxRetries 1) 후 실패한 5xx 는 2, 재시도 없는 400 은 1', async () => {
    const logs = captureLogs();
    const unavailable: VendorTurn = {
      error: { status: 500, body: { error: { type: 'server_error', message: 'R2-500' } } },
    };
    await ask(await openAiRuntime([unavailable]), '가격');
    await ask(await openAiRuntime([REJECTED_400]), '가격');
    const [first, second] = logs('chat.llm_error');
    expect(first).toMatchObject({ code: 'unavailable', httpStatus: 500, attempts: 2 });
    expect(second).toMatchObject({ code: 'request_rejected', httpStatus: 400, attempts: 1 });
  }, 20_000);
});
