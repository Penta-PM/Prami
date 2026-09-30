// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatReplyOut, ChatSettings } from '@/server/chat/graph/types';
import { defaultModelFor } from '@/server/llm/models';
import { createAnthropicChatModel } from '@/server/llm/vendors/anthropic-chat';
import { createGoogleChatModel } from '@/server/llm/vendors/google-chat';
import { createOpenAIChatModel } from '@/server/llm/vendors/openai-chat';

import { createAnthropicStub, toolUseBlock } from '../../fixtures/chat/anthropic-http';
import {
  createGeminiStub,
  createOpenAIStub,
  type VendorTurn,
} from '../../fixtures/chat/vendor-http';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { expectNoSecret } from '../../helpers/secret';

/**
 * AC-241 벤더 계약 테스트 (PRAMI-002 §4.5, PR-C): 같은 시나리오(가격 조회 도구 1회 → 답)를 anthropic/openai/google **실제 어댑터**
 * (전송 계층 스텁)로 실행하면 같은 형태의 ChatReply. 벤더별 오류 매핑(§4.8.3), maxRetries 1·타임아웃, 강제 도구 선택 없음,
 * 키는 인증 헤더에만 — URL·본문·응답에 없다. 실벤더 호출 없음.
 */
const KEYS = {
  anthropic: 'sk-ant-api03-test-CONTRACT-anthropic-000001',
  openai: 'sk-proj-test-CONTRACT-openai-0000000000000002',
  google: 'AIzaTestCONTRACTgoogle000000000000000003',
} as const;
type VendorId = keyof typeof KEYS;
const VENDORS: VendorId[] = ['anthropic', 'openai', 'google'];

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function anthropicTurns(turns: VendorTurn[]) {
  return turns.map((turn) => {
    if ('toolCall' in turn) {
      return {
        content: [toolUseBlock('toolu_1', turn.toolCall.name, turn.toolCall.args)],
        stop_reason: 'tool_use' as const,
      };
    }
    return {
      content: [{ type: 'text', text: 'text' in turn ? turn.text : '' }],
      stop_reason: 'end_turn' as const,
    };
  });
}

/** 벤더 어댑터 + 전송 스텁으로 그래프 1회 */
async function runVendor(
  vendor: VendorId,
  turns: VendorTurn[],
  settings: Partial<ChatSettings> = {},
) {
  const modelId = defaultModelFor(vendor)!;
  let stub: {
    fetch: typeof fetch;
    requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[];
  };
  if (vendor === 'anthropic') {
    const errorTurn = turns.find((turn) => 'error' in turn || 'hang' in turn);
    stub = errorTurn
      ? createOpenAIStub(turns)
      : createAnthropicStub(anthropicTurns(turns), modelId);
  } else stub = vendor === 'openai' ? createOpenAIStub(turns) : createGeminiStub(turns);
  if (vendor === 'google') vi.stubGlobal('fetch', stub.fetch);
  const factory = {
    anthropic: createAnthropicChatModel,
    openai: createOpenAIChatModel,
    google: createGoogleChatModel,
  }[vendor];
  const runtime = scriptedRuntime(ctx.handle, { status: 'ready', vendor, modelId, settings });
  const credential = await runtime.resolveCredential();
  runtime.resolveCredential = async () => ({
    ...credential,
    createModel: (options) => factory(KEYS[vendor], modelId, { ...options, fetch: stub.fetch }),
  });
  const reply = await ask(runtime, 'Wapples-500 가격 알려줘');
  return { reply, requests: stub.requests };
}

const SCENARIO: VendorTurn[] = [
  { toolCall: { name: 'price_lookup', args: { query: 'Wapples-500', family: null } } },
  { text: 'Wapples-500 은 두 모델이 있습니다.' },
];

/** 벤더·모델 표시(llm)만 다르고 나머지는 같아야 한다 */
const shape = (reply: ChatReplyOut) => ({ ...reply, llm: null });

describe('같은 시나리오 → 같은 형태의 ChatReply (AC-241)', () => {
  it('anthropic·openai·google 어댑터가 같은 응답(모드·의도·답·후보·액션)을 낸다, 키는 인증 헤더에만', async () => {
    const results = [];
    for (const vendor of VENDORS) results.push({ vendor, ...(await runVendor(vendor, SCENARIO)) });
    const [first, ...rest] = results;
    expect(first!.reply).toMatchObject({
      mode: 'llm',
      intent: 'price',
      reply: 'Wapples-500 은 두 모델이 있습니다.',
    });
    expect(first!.reply.candidates).toHaveLength(2);
    for (const other of rest) expect(shape(other.reply)).toEqual(shape(first!.reply));
    for (const { vendor, reply, requests } of results) {
      expect(reply.llm).toMatchObject({ status: 'ready', vendor, model: defaultModelFor(vendor) });
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expectNoSecret(request.url, KEYS[vendor], `${vendor} URL`);
        expectNoSecret(JSON.stringify(request.body), KEYS[vendor], `${vendor} 본문`);
      }
      expectNoSecret(JSON.stringify(reply), KEYS[vendor], `${vendor} 응답`);
    }
    const [anthropic, openai, google] = results.map((result) => result.requests[0]!);
    expect(anthropic!.headers['x-api-key']).toBe(KEYS.anthropic);
    expect(openai!.headers.authorization).toBe(`Bearer ${KEYS.openai}`);
    expect(google!.headers['x-goog-api-key']).toBe(KEYS.google);
  });

  it('강제 도구 선택 없음 — OpenAI tool_choice 없음·strict, Gemini toolConfig 강제 모드 없음, 도구 3개 바인딩', async () => {
    const { requests: openai } = await runVendor('openai', SCENARIO);
    const body = openai[0]!.body;
    expect(body).not.toHaveProperty('tool_choice');
    expect(body.model).toBe('gpt-6.1-sol');
    expect(body.max_completion_tokens).toBe(1024);
    const tools = body.tools as { function: { name: string; strict?: boolean } }[];
    expect(tools.map((tool) => tool.function.name)).toEqual([
      'price_lookup',
      'price_compare_previous',
      'quote_start',
    ]);
    expect(tools.every((tool) => tool.function.strict === true)).toBe(true);
    const { requests: google } = await runVendor('google', SCENARIO);
    const gBody = google[0]!.body as {
      toolConfig?: { functionCallingConfig?: { mode?: string } };
      tools: { functionDeclarations: unknown[] }[];
    };
    expect(google[0]!.url).toContain('/v1beta/models/gemini-3.8-flash:');
    expect(gBody.toolConfig?.functionCallingConfig?.mode ?? 'AUTO').not.toBe('ANY');
    expect(gBody.tools[0]!.functionDeclarations).toHaveLength(3);
  });
});

describe('벤더별 오류 매핑 (AC-241 · §4.8.3)', () => {
  it.each([
    [
      'openai',
      401,
      {
        error: {
          message: 'Incorrect API key MARKER',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      },
      'invalid',
    ],
    [
      'openai',
      429,
      { error: { message: 'MARKER', type: 'insufficient_quota', code: 'insufficient_quota' } },
      'rate_limited',
    ],
    ['openai', 503, { error: { message: 'MARKER', type: 'server_error' } }, 'unavailable'],
    [
      'google',
      400,
      {
        error: {
          code: 400,
          message: 'API key not valid MARKER',
          status: 'INVALID_ARGUMENT',
          details: [
            { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
          ],
        },
      },
      'invalid',
    ],
    [
      'google',
      403,
      { error: { code: 403, message: 'MARKER', status: 'PERMISSION_DENIED' } },
      'forbidden',
    ],
    [
      'google',
      429,
      { error: { code: 429, message: 'MARKER', status: 'RESOURCE_EXHAUSTED' } },
      'rate_limited',
    ],
    ['google', 500, { error: { code: 500, message: 'MARKER', status: 'INTERNAL' } }, 'unavailable'],
  ] as const)(
    '%s %d → setup.status=%s, 규칙 답, 벤더 원문 없음',
    async (vendor, status, body, expected) => {
      const { reply } = await runVendor(vendor, [{ error: { status, body } }]);
      expect(reply.setup?.status).toBe(expected);
      expect(reply.mode).toBe('rule');
      expect(JSON.stringify(reply)).not.toContain('MARKER');
    },
    20_000,
  );
});

describe('어댑터 상한 (AC-241·AC-229)', () => {
  it('각 어댑터가 maxRetries 1·타임아웃·maxTokens 를 설정한다', () => {
    const options = { maxTokens: 777, timeoutMs: 20_000 };
    const openai = createOpenAIChatModel(KEYS.openai, 'gpt-6.1-sol', options) as unknown as {
      caller: { maxRetries: number };
      timeout: number;
      maxTokens: number;
    };
    expect(openai.caller.maxRetries).toBe(1);
    expect(openai.timeout).toBe(20_000);
    expect(openai.maxTokens).toBe(777);
    const google = createGoogleChatModel(KEYS.google, 'gemini-3.8-flash', options) as unknown as {
      caller: { maxRetries: number };
      maxOutputTokens: number;
    };
    expect(google.caller.maxRetries).toBe(1);
    expect(google.maxOutputTokens).toBe(777);
  });

  it.each(['openai', 'google'] as const)(
    '%s: 응답이 오지 않으면 호출 타임아웃(signal)으로 끊고 unavailable + 규칙 답',
    async (vendor) => {
      const started = Date.now();
      const { reply } = await runVendor(vendor, [{ hang: true }], { timeoutMs: 400 });
      expect(Date.now() - started).toBeLessThan(8_000);
      expect(reply).toMatchObject({ mode: 'rule', setup: { status: 'unavailable' } });
    },
    20_000,
  );
});
