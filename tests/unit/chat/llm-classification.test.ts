// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import { TOO_LONG_REPLY, TRUNCATED_OUTPUT_NOTICE } from '@/server/chat/graph/messages';
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
import { createXaiChatModel } from '@/server/llm/vendors/xai';

import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';

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

/**
 * AC-369 (r3, PR #22 L-1): LangChain 이 `ContextOverflowError` 로 바꾼 컨텍스트 초과도 too_long. 래핑되면 `status`·`lc_error_code`
 * 가 사라져 이전에는 llm_error(일반 안내)였다 — OpenAI 실제형 메시지와 xAI(`withXaiErrorBody` 경로)가 그 경우다.
 */
describe('AC-369 컨텍스트 초과 — ContextOverflowError 래핑 포함 → too_long (JSON·SSE)', () => {
  const XAI_KEY = 'xai-test-CLASSIFY-context-overflow-0000000005';
  const openAiContext = (message: string) =>
    json(400, {
      error: {
        message,
        type: 'invalid_request_error',
        code: 'context_length_exceeded',
        param: 'input',
      },
    });
  const xaiContext = json(400, { code: 'context_length_exceeded', error: VENDOR_MESSAGE });

  async function xaiRuntime(fetchImpl: FetchImpl): Promise<ChatRuntime> {
    const runtime = scriptedRuntime(ctx.handle, {
      status: 'ready',
      vendor: 'xai',
      modelId: 'grok-4.7',
    });
    const credential = await runtime.resolveCredential();
    runtime.resolveCredential = async () => ({
      ...credential,
      createModel: (options) =>
        createXaiChatModel(XAI_KEY, 'grok-4.7', {
          ...options,
          fetch: fetchImpl as unknown as typeof fetch,
        }),
    });
    return runtime;
  }

  const overflowModel = () =>
    new ScriptedChatModel([
      {
        throw: {
          name: 'ContextOverflowError',
          message: "Input exceeded the model's context window.",
        },
      },
    ]);

  it.each<[string, () => Promise<ChatRuntime>, string]>([
    [
      '① OpenAI 실제형 메시지 "maximum context length is …"',
      () =>
        runtimeFor(
          'openai',
          openAiContext(
            `This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens. ${VENDOR_MESSAGE}`,
          ),
        ),
      'BadRequestError',
    ],
    [
      '② OpenAI 같은 코드 + "too long"',
      () => runtimeFor('openai', openAiContext(`too long ${VENDOR_MESSAGE}`)),
      'BadRequestError',
    ],
    [
      '③ xAI 400 {code:context_length_exceeded} (withXaiErrorBody)',
      () => xaiRuntime(xaiContext),
      'BadRequestError',
    ],
    [
      '④ ContextOverflowError 를 직접 던지는 모델',
      async () =>
        scriptedRuntime(ctx.handle, {
          status: 'ready',
          vendor: 'openai',
          modelId: 'gpt-6.1-sol',
          model: overflowModel(),
        }),
      'ContextOverflowError',
    ],
  ])(
    '%s',
    async (_label, makeRuntime, sdkErrorName) => {
      const logs = captureLlmErrors();
      const reply = await ask(await makeRuntime(), 'Wapples-500 가격');
      const final = await sse(await makeRuntime());
      for (const answer of [reply, final]) {
        expect(answer.reply).toBe(TOO_LONG_REPLY);
        expect(JSON.stringify(answer)).not.toContain(VENDOR_MESSAGE);
      }
      const lines = logs();
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(line).toMatchObject({ code: 'too_long', sdkErrorName });
      expect(lines.map((line) => line.stream)).toEqual([false, true]);
    },
    30_000,
  );

  it('다른 400(invalid_value)은 여전히 request_rejected', async () => {
    const logs = captureLlmErrors();
    const fetchImpl = json(400, {
      error: { message: VENDOR_MESSAGE, type: 'invalid_request_error', code: 'invalid_value' },
    });
    await ask(await runtimeFor('openai', fetchImpl), 'Wapples-500 가격');
    await ask(
      await xaiRuntime(json(400, { code: 'invalid-argument', error: VENDOR_MESSAGE })),
      'Wapples-500 가격',
    );
    expect(logs().map((line) => line.code)).toEqual(['request_rejected', 'request_rejected']);
  });

  it('분류 표: cause 체인의 ContextOverflowError 는 상태 판정보다 앞', () => {
    const wrapped = Object.assign(new Error('wrapped'), {
      name: 'ContextOverflowError',
      cause: { status: 400, code: 'context_length_exceeded' },
    });
    expect(normalizeLlmError(wrapped)).toBe('too_long');
    expect(normalizeLlmError({ status: 503, cause: wrapped })).toBe('too_long');
  });
});

/** 410 + 벤더 사람용 메시지(폐기 패턴 포함) — 벤더별 오류 본문 형태 (PRAMI-003 §4.7.7 ②, AC-368 ②) */
const GONE_MESSAGE = `This endpoint is deprecated ${VENDOR_MESSAGE}`;
const GONE_410: Record<Vendor, FetchImpl> = {
  openai: json(410, { error: { message: GONE_MESSAGE, type: 'invalid_request_error' } }),
  openrouter: json(410, { error: { message: GONE_MESSAGE, code: 410 } }),
  anthropic: json(410, { type: 'error', error: { type: 'api_error', message: GONE_MESSAGE } }),
  google: json(410, { error: { code: 410, message: GONE_MESSAGE, status: 'FAILED_PRECONDITION' } }),
};

describe('410 Gone → request_rejected · vendorErrorCode deprecated · error 로그 — 벤더 공통 (AC-368 ②)', () => {
  it.each(['openai', 'openrouter', 'anthropic', 'google'] as const)(
    '%s (JSON·SSE)',
    async (vendor) => {
      const logs = captureLlmErrors();
      const errorLevel = vi.mocked(console.error);
      const reply = await ask(await runtimeFor(vendor, GONE_410[vendor]), 'Wapples-500 가격');
      const final = await sse(await runtimeFor(vendor, GONE_410[vendor]));
      for (const answer of [reply, final]) {
        expect(answer.mode).toBe('rule');
        expect(JSON.stringify(answer)).not.toContain(VENDOR_MESSAGE);
      }
      const lines = logs();
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toMatchObject({
          code: 'request_rejected',
          httpStatus: 410,
          vendorErrorCode: 'deprecated',
          vendor,
        });
      }
      expect(
        errorLevel.mock.calls.filter(([text]) => String(text).includes('chat.llm_error')),
      ).toHaveLength(2);
    },
    30_000,
  );

  it('분류 표: 410 은 본문과 관계없이 request_rejected', () => {
    expect(normalizeLlmError({ status: 410 })).toBe('request_rejected');
    expect(normalizeLlmError({ status: 410, code: 'invalid_api_key' })).toBe('request_rejected');
  });
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
        // AC-372 (PR #20 L-b): SDK 가 본문 status 를 노출하지 않아도 HTTP 상태에서 파생
        vendorErrorType: 'INVALID_ARGUMENT',
        vendorErrorCode: 'API_KEY_INVALID',
        attempts: 1,
        adapter: '@langchain/google-genai@2.3.2',
      },
    ],
    [
      'OpenRouter 네트워크 오류',
      'openrouter',
      networkFailure,
      // 벤더 4종 모두 시도 수가 관측된다 (attemptCounter 가 caller 를 찾지 못하면 1 로 남아 실패)
      { code: 'unavailable', source: 'network', sdkErrorName: 'APIConnectionError', attempts: 2 },
    ],
    [
      'Gemini 500 (재시도 1회 → attempts 2)',
      'google',
      json(500, { error: { code: 500, message: VENDOR_MESSAGE, status: 'INTERNAL' } }),
      { code: 'unavailable', httpStatus: 500, attempts: 2 },
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

/** AC-373 ② (PR #22 I-13·I-16): 400·410·415·422 는 재시도하지 않는다 — 벤더 요청 1건, attempts 1. 429·5xx·네트워크만 재시도 */
describe('AC-373 ② 4xx 재시도 없음 — 벤더 공통', () => {
  const counting = (status: number, body: unknown) => {
    const calls = { n: 0 };
    const impl: FetchImpl = async () => {
      calls.n += 1;
      return Response.json(body, { status });
    };
    return { calls, impl };
  };
  const BODY = { error: { message: VENDOR_MESSAGE, type: 'invalid_request_error' } };

  it.each(
    (['openai', 'openrouter', 'anthropic', 'google'] as const).flatMap((vendor) =>
      [400, 410, 415, 422].map((status) => [vendor, status] as const),
    ),
  )('%s %i → 요청 1건 · attempts 1', async (vendor, status) => {
    const logs = captureLlmErrors();
    const { calls, impl } = counting(status, BODY);
    await ask(await runtimeFor(vendor, impl), 'Wapples-500 가격');
    expect(calls.n).toBe(1);
    expect(logs()[0]).toMatchObject({ httpStatus: status, attempts: 1 });
  });

  it.each([500, 503] as const)(
    'openai %i 은 재시도 유지 → 요청 2건 · attempts 2',
    async (status) => {
      const logs = captureLlmErrors();
      const { calls, impl } = counting(status, BODY);
      await ask(await runtimeFor('openai', impl), 'Wapples-500 가격');
      expect(calls.n).toBe(2);
      expect(logs()[0]).toMatchObject({ httpStatus: status, attempts: 2 });
    },
  );

  it('Gemini 403·404·429·503 도 상태에서 vendorErrorType 파생', async () => {
    const expected: Record<number, string> = {
      403: 'PERMISSION_DENIED',
      404: 'NOT_FOUND',
      429: 'RESOURCE_EXHAUSTED',
      503: 'UNAVAILABLE',
    };
    for (const [status, type] of Object.entries(expected)) {
      const logs = captureLlmErrors();
      await ask(
        await runtimeFor('google', json(Number(status), { error: { message: VENDOR_MESSAGE } })),
        'Wapples-500 가격',
      );
      expect(logs().at(-1)).toMatchObject({ httpStatus: Number(status), vendorErrorType: type });
      vi.restoreAllMocks();
    }
  });
});

/** AC-372 (PR #20 I-1): 200 잘린 JSON — SSE 경로의 sdkErrorName 이 JSON 경로와 같다 */
describe('AC-372 응답 파싱 실패 sdkErrorName JSON = SSE', () => {
  const broken: FetchImpl = async () =>
    new Response(`{"broken": ${VENDOR_MESSAGE}`, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const brokenSse: FetchImpl = async () =>
    new Response(
      `event: message_start
data: {"broken": ${VENDOR_MESSAGE}

`,
      {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      },
    );

  it.each([
    ['openai', 'SSE 데이터 줄이 잘린 JSON', brokenSse],
    ['anthropic', 'SSE 데이터 줄이 잘린 JSON', brokenSse],
    ['openai', '스트림 요청에 SSE 가 아닌 잘린 JSON 본문(이벤트 0개)', broken],
    ['anthropic', '스트림 요청에 SSE 가 아닌 잘린 JSON 본문(이벤트 0개)', broken],
  ] as const)('%s — %s', async (vendor, _label, streamBody) => {
    const logs = captureLlmErrors();
    await ask(await runtimeFor(vendor, broken), 'Wapples-500 가격');
    await sse(await runtimeFor(vendor, streamBody));
    const [json, stream] = logs();
    expect(json).toMatchObject({ stream: false, sdkErrorName: 'SyntaxError' });
    expect(stream).toMatchObject({ stream: true, sdkErrorName: json!.sdkErrorName });
  });
});

/** AC-372 (선택, PR #20 I-2): OpenRouter(Chat Completions) `finish_reason:'length'` → truncated_output notice, JSON·SSE */
describe('AC-372 OpenRouter finish_reason length', () => {
  const TEXT = 'Wapples-500 판매가는 두 모델입니다.';
  const completion: FetchImpl = async (_url, init) => {
    const streaming = JSON.parse(String(init?.body ?? '{}')).stream === true;
    if (!streaming) {
      return Response.json({
        id: 'gen-1',
        object: 'chat.completion',
        created: 1,
        model: 'm',
        choices: [
          { index: 0, message: { role: 'assistant', content: TEXT }, finish_reason: 'length' },
        ],
      });
    }
    const chunk = (delta: unknown, finish: string | null) =>
      `data: ${JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    return new Response(
      chunk({ role: 'assistant', content: TEXT }, null) + chunk({}, 'length') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };

  it.each(['json', 'sse'] as const)('%s', async (path) => {
    const logs = captureLlmErrors();
    const runtime = await runtimeFor('openrouter', completion);
    const reply = path === 'json' ? await ask(runtime, 'Wapples-500 가격') : await sse(runtime);
    expect(reply.mode).toBe('llm');
    expect(reply.notice).toContain(TRUNCATED_OUTPUT_NOTICE);
    expect(logs()[0]).toMatchObject({
      vendor: 'openrouter',
      vendorErrorType: 'incomplete_max_output_tokens',
    });
  });
});
