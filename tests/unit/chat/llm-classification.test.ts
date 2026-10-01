// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import { TOO_LONG_REPLY } from '@/server/chat/graph/messages';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatReplyOut, ChatRuntime } from '@/server/chat/graph/types';
import { normalizeLlmError } from '@/server/llm/errors';
import { defaultModelFor } from '@/server/llm/models';
import { createAnthropicChatModel } from '@/server/llm/vendors/anthropic-chat';
import { createGoogleChatModel } from '@/server/llm/vendors/google-chat';
import {
  createOpenAIChatModel,
  createOpenAICompatibleChatModel,
} from '@/server/llm/vendors/openai-chat';
import { OPENROUTER_API_BASE } from '@/server/llm/vendors/openrouter';
import type { ChatModelFactoryOptions } from '@/server/llm/vendors/types';

import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { expectNoSecret } from '../../helpers/secret';

/**
 * PRAMI-003 §4.5.5 L-2 분류 + AC-366 벤더별 진단 필드 — 실제 어댑터 + 전송 가로채기(실벤더 호출 0).
 * AC-354 ① OpenAI 400 context_length_exceeded → too_long ② 소켓 끊김·fetch failed·ECONNRESET → unavailable(source network).
 * AC-366: OpenAI 401/429, Anthropic 529, Gemini 400 API_KEY_INVALID, 네트워크, 타임아웃, 응답 파싱 실패 각각
 * `chat.llm_error` 에 code·source·httpStatus·vendorErrorType·vendorRequestId·sdkErrorName·attempts·latencyMs·stream·adapter,
 * 벤더 원문 메시지·키 0.
 */
const VENDOR_MESSAGE = 'CLASSIFY-VENDOR-MESSAGE do not log';
const KEYS = {
  openai: 'sk-proj-test-CLASSIFY-openai-00000000000001',
  openrouter: 'sk-or-v1-test-CLASSIFY-openrouter-000000002',
  anthropic: 'sk-ant-api03-test-CLASSIFY-anthropic-000003',
  google: 'AIzaTestCLASSIFYgoogle0000000000000000004',
} as const;
type Vendor = keyof typeof KEYS;

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

type Line = Record<string, unknown>;

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
      .map((line) => {
        expect(line).not.toContain(VENDOR_MESSAGE);
        for (const key of Object.values(KEYS)) expectNoSecret(line, key, 'chat.llm_error');
        return JSON.parse(line) as Line;
      });
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () => Response.json(body, { status, headers })) as FetchImpl;

function factory(vendor: Vendor, fetchImpl: FetchImpl) {
  const modelId = defaultModelFor(vendor)!;
  const fetchFn = fetchImpl as unknown as typeof fetch;
  return (options: ChatModelFactoryOptions) => {
    const withFetch = { ...options, fetch: fetchFn };
    if (vendor === 'openai') return createOpenAIChatModel(KEYS.openai, modelId, withFetch);
    if (vendor === 'anthropic') return createAnthropicChatModel(KEYS.anthropic, modelId, withFetch);
    if (vendor === 'google') return createGoogleChatModel(KEYS.google, modelId, withFetch);
    return createOpenAICompatibleChatModel(
      KEYS.openrouter,
      modelId,
      withFetch,
      OPENROUTER_API_BASE,
    );
  };
}

async function runtimeFor(
  vendor: Vendor,
  fetchImpl: FetchImpl,
  settings: { timeoutMs?: number } = {},
): Promise<ChatRuntime> {
  if (vendor === 'google') vi.stubGlobal('fetch', fetchImpl);
  const modelId = defaultModelFor(vendor)!;
  const runtime = scriptedRuntime(ctx.handle, { status: 'ready', vendor, modelId, settings });
  const credential = await runtime.resolveCredential();
  runtime.resolveCredential = async () => ({
    ...credential,
    createModel: factory(vendor, fetchImpl),
  });
  return runtime;
}

async function sse(runtime: ChatRuntime): Promise<ChatReplyOut> {
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

const CONTEXT_400 = {
  error: {
    message: VENDOR_MESSAGE,
    type: 'invalid_request_error',
    code: 'context_length_exceeded',
    param: 'input',
  },
};

const networkFailure: FetchImpl = async () => {
  throw Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(`socket ${VENDOR_MESSAGE}`), { code: 'ECONNRESET' }),
  });
};

function hang(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
  });
}

describe('L-2 컨텍스트 초과 → too_long (AC-354 ①)', () => {
  it.each(['openai', 'openrouter'] as const)(
    '%s 400 context_length_exceeded: JSON·SSE 모두 "대화를 새로 시작해주세요", 진단 code too_long',
    async (vendor) => {
      const logs = captureLlmErrors();
      const fetchImpl = json(400, CONTEXT_400, { 'x-request-id': 'req_ctx_1' });
      const reply = await ask(await runtimeFor(vendor, fetchImpl), 'Wapples-500 가격');
      const final = await sse(await runtimeFor(vendor, fetchImpl));
      for (const answer of [reply, final]) expect(answer.reply).toBe(TOO_LONG_REPLY);
      const [jsonLine, sseLine] = logs();
      expect(jsonLine).toMatchObject({
        code: 'too_long',
        source: 'http',
        httpStatus: 400,
        vendorErrorCode: 'context_length_exceeded',
        vendorErrorParam: 'input',
        vendorRequestId: 'req_ctx_1',
        sdkErrorName: 'BadRequestError',
        stream: false,
      });
      expect(sseLine).toMatchObject({ code: 'too_long', stream: true });
    },
  );

  it('분류 표: lc CONTEXT_OVERFLOW · Anthropic request_too_large(413) → too_long, 다른 400 은 request_rejected', () => {
    expect(normalizeLlmError({ status: 400, lc_error_code: 'CONTEXT_OVERFLOW' })).toBe('too_long');
    expect(
      normalizeLlmError({
        status: 413,
        error: { type: 'error', error: { type: 'request_too_large' } },
      }),
    ).toBe('too_long');
    expect(normalizeLlmError({ status: 400, code: 'unsupported_parameter' })).toBe(
      'request_rejected',
    );
    // 컨텍스트 코드라도 400 이 아니면 상태 규칙을 따른다
    expect(normalizeLlmError({ status: 500, code: 'context_length_exceeded' })).toBe('unavailable');
  });
});

describe('L-2 연결 오류 → unavailable · source network (AC-354 ②)', () => {
  it.each([
    ['TypeError fetch failed → cause ECONNRESET', { cause: { code: 'ECONNRESET' } }],
    ['코드만 ECONNREFUSED', { code: 'ECONNREFUSED' }],
    ['undici UND_ERR_SOCKET', { cause: { code: 'UND_ERR_SOCKET' } }],
    ['ENOTFOUND (cause 3단계)', { cause: { cause: { cause: { code: 'ENOTFOUND' } } } }],
  ])('분류 표: %s', (_label, shape) => {
    expect(normalizeLlmError(Object.assign(new Error('x'), shape))).toBe('unavailable');
  });

  it('cause 4단계 밖은 보지 않는다, 일반 TypeError(로컬 버그)는 llm_error', () => {
    const deep = { cause: { cause: { cause: { cause: { code: 'ECONNRESET' } } } } };
    expect(normalizeLlmError(Object.assign(new Error('x'), deep))).toBe('llm_error');
    expect(
      normalizeLlmError(new TypeError("Cannot read properties of undefined (reading 'x')")),
    ).toBe('llm_error');
  });

  it.each(['openai', 'anthropic'] as const)(
    '%s 소켓 끊김: JSON·SSE 규칙 폴백, code unavailable · source network · sdkErrorName APIConnectionError · attempts 2',
    async (vendor) => {
      const logs = captureLlmErrors();
      const reply = await ask(await runtimeFor(vendor, networkFailure), 'Wapples-500 가격');
      const final = await sse(await runtimeFor(vendor, networkFailure));
      expect(reply.mode).toBe('rule');
      expect(final.mode).toBe('rule');
      for (const [index, line] of logs().entries()) {
        expect(line).toMatchObject({
          code: 'unavailable',
          source: 'network',
          sdkErrorName: 'APIConnectionError',
          attempts: 2,
          stream: index === 1,
        });
        expect(line).not.toHaveProperty('httpStatus');
      }
    },
    30_000,
  );
});

describe('AC-366 벤더별 진단 필드 (fake·전송 가로채기)', () => {
  const REQUIRED = ['code', 'source', 'sdkErrorName', 'attempts', 'latencyMs', 'stream', 'adapter'];

  it.each([
    [
      'OpenAI 401 invalid_api_key',
      'openai',
      json(
        401,
        {
          error: {
            message: VENDOR_MESSAGE,
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        },
        { 'x-request-id': 'req_401' },
      ),
      {
        code: 'invalid_key',
        httpStatus: 401,
        vendorErrorCode: 'invalid_api_key',
        vendorRequestId: 'req_401',
        sdkErrorName: 'AuthenticationError',
        attempts: 1,
      },
    ],
    [
      'OpenAI 429 insufficient_quota',
      'openai',
      json(429, {
        error: { message: VENDOR_MESSAGE, type: 'insufficient_quota', code: 'insufficient_quota' },
      }),
      { code: 'rate_limited', httpStatus: 429, vendorErrorType: 'insufficient_quota', attempts: 1 },
    ],
    [
      'Anthropic 529 overloaded_error',
      'anthropic',
      json(
        529,
        { type: 'error', error: { type: 'overloaded_error', message: VENDOR_MESSAGE } },
        { 'request-id': 'req_ant_529' },
      ),
      {
        code: 'unavailable',
        httpStatus: 529,
        vendorErrorType: 'overloaded_error',
        vendorRequestId: 'req_ant_529',
        attempts: 2,
        adapter: '@langchain/anthropic@1.5.11',
      },
    ],
    [
      'Gemini 400 API_KEY_INVALID',
      'google',
      json(400, {
        error: {
          code: 400,
          message: VENDOR_MESSAGE,
          status: 'INVALID_ARGUMENT',
          details: [
            { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
          ],
        },
      }),
      {
        code: 'invalid_key',
        httpStatus: 400,
        vendorErrorCode: 'API_KEY_INVALID',
        attempts: 1,
        adapter: '@langchain/google-genai@2.3.2',
      },
    ],
    [
      'OpenRouter 네트워크 오류',
      'openrouter',
      networkFailure,
      { code: 'unavailable', source: 'network', sdkErrorName: 'APIConnectionError' },
    ],
    [
      'OpenAI 응답 파싱 실패(2xx 본문이 JSON 아님)',
      'openai',
      (async () =>
        new Response(`{"broken": ${VENDOR_MESSAGE}`, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as FetchImpl,
      // LangChain 이 파싱 오류를 재시도한다(maxRetries 1) — 실제 시도 수 2
      { code: 'llm_error', source: 'local', sdkErrorName: 'SyntaxError', attempts: 2 },
    ],
  ] as const)(
    '%s',
    async (_label, vendor, fetchImpl, expected) => {
      const logs = captureLlmErrors();
      const reply = await ask(await runtimeFor(vendor, fetchImpl), 'Wapples-500 가격');
      expect(JSON.stringify(reply)).not.toContain(VENDOR_MESSAGE);
      const [line] = logs();
      for (const key of REQUIRED) expect(line).toHaveProperty(key);
      expect(line).toMatchObject({ vendor, stream: false, ...expected });
      expect(line).not.toHaveProperty('debugMessage');
    },
    30_000,
  );

  it('타임아웃(무응답): code unavailable · source timeout · attempts 1', async () => {
    const logs = captureLlmErrors();
    await ask(await runtimeFor('openai', hang, { timeoutMs: 200 }), 'Wapples-500 가격');
    const [line] = logs();
    expect(line).toMatchObject({ code: 'unavailable', source: 'timeout', attempts: 1 });
    expect(line).not.toHaveProperty('httpStatus');
  });
});
