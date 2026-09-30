// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ChatSettings } from '@/server/chat/graph/types';
import { LLM_MODELS } from '@/server/llm/models';
import {
  createAnthropicChatModel,
  SERVER_FALLBACK_BETA,
} from '@/server/llm/vendors/anthropic-chat';

import {
  createAnthropicStub,
  thinkingBlock,
  toolUseBlock,
  type AnthropicResponse,
} from '../../fixtures/chat/anthropic-http';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * AC-231 (r2) Anthropic 요청 형태 — **실제 HTTP 요청 본문·헤더를 전송 계층에서 가로채** 모델별로 확인한다 (Q-10 ② 어댑터 확장 증명).
 * 그래프 전체(도구 루프 2회)를 ChatAnthropic + fetch 스텁으로 돌린다. AC-229 ① 어댑터 상한(maxTokens·재시도·타임아웃)도 함께.
 */
const KEY = 'sk-ant-api03-test-REQUEST-SHAPE-0000000000';
let ctx: ChatTestDb;

beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);

afterAll(async () => {
  await ctx.handle.close();
});

const TOOL_ROUND: AnthropicResponse = {
  content: [
    thinkingBlock('사용자가 가격을 묻는다 — 도구를 부른다'),
    { type: 'text', text: '조회해 볼게요.' },
    toolUseBlock('toolu_1', 'price_lookup', { query: 'Wapples-500', family: null }),
  ],
  stop_reason: 'tool_use',
};
const FINAL_ROUND: AnthropicResponse = {
  content: [{ type: 'text', text: 'Wapples-500 은 두 모델이 있습니다.' }],
  stop_reason: 'end_turn',
};

async function runWith(
  modelId: string,
  responses: AnthropicResponse[],
  settings: Partial<ChatSettings> = {},
) {
  const stub = createAnthropicStub(responses, modelId);
  const runtime = scriptedRuntime(ctx.handle, { status: 'ready', modelId, settings });
  const credential = await runtime.resolveCredential();
  runtime.resolveCredential = async () => ({
    ...credential,
    createModel: (options) =>
      createAnthropicChatModel(KEY, modelId, { ...options, fetch: stub.fetch }),
  });
  const reply = await ask(runtime, 'Wapples-500 가격 알려줘');
  return { reply, requests: stub.requests };
}

type Message = { role: string; content: unknown };

describe.each(LLM_MODELS.anthropic.map((model) => [model.id, model.anthropic!] as const))(
  'AC-231 %s',
  (modelId, traits) => {
    it('①~⑥ 모델·thinking 없음·tool_choice/strict·프리필 금지·effort·서버측 폴백 + ⑧ preserved thinking', async () => {
      const { reply, requests } = await runWith(modelId, [TOOL_ROUND, FINAL_ROUND]);
      expect(requests).toHaveLength(2);
      for (const { body, headers, url } of requests) {
        expect(url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
        expect(body.model).toBe(modelId); // ①
        expect(body).not.toHaveProperty('thinking'); // ②
        expect(
          body.tool_choice === undefined || (body.tool_choice as { type: string }).type === 'auto',
        ).toBe(true); // ③
        const tools = body.tools as { name: string; strict?: boolean }[];
        expect(tools.map((tool) => tool.name)).toEqual([
          'price_lookup',
          'price_compare_previous',
          'quote_start',
        ]);
        expect(tools.every((tool) => tool.strict === true)).toBe(true);
        expect((body.messages as Message[]).at(-1)!.role).not.toBe('assistant'); // ④
        expect(body).not.toHaveProperty('effort'); // ⑤ top-level effort 없음
        const beta = headers['anthropic-beta'] ?? '';
        expect(beta).not.toContain('server-side-fallback-2026-06-01');
        expect(Array.isArray(body.fallbacks)).toBe(false);
        if (traits.effort) expect(body.output_config).toEqual({ effort: 'low' });
        else expect(body).not.toHaveProperty('output_config');
        if (traits.serverFallback) {
          expect(body.fallbacks).toBe('default'); // ⑥
          expect(beta.split(',').map((value) => value.trim())).toContain(SERVER_FALLBACK_BETA);
        } else {
          expect(body).not.toHaveProperty('fallbacks');
          expect(beta).not.toContain('server-side-fallback');
        }
        // AC-229 ①: max_tokens = env 값, 재시도 헤더 0회차, 타임아웃 = CHAT_LLM_TIMEOUT_MS(2s)
        expect(body.max_tokens).toBe(1024);
        expect(headers['x-stainless-timeout']).toBe('2');
        // 키는 헤더(x-api-key)에만 — URL·본문에 없다
        expect(url).not.toContain(KEY);
        expect(JSON.stringify(body)).not.toContain(KEY);
      }
      // ⑧ 2회차 요청의 이전 assistant content 가 1회차 응답 content 와 바이트 단위로 같다 (사고 블록·서명 포함)
      const second = requests[1]!.body.messages as Message[];
      const assistant = second.filter((message) => message.role === 'assistant').at(-1)!;
      expect(JSON.stringify(assistant.content)).toBe(JSON.stringify(TOOL_ROUND.content));
      expect(reply).toMatchObject({ mode: 'llm', intent: 'price' });
    });

    it('⑦ stop_reason=refusal (content 있음) → refused 안내, content 텍스트는 응답에 없다', async () => {
      const { reply } = await runWith(modelId, [
        { content: [{ type: 'text', text: 'REFUSAL-BODY-TEXT-431' }], stop_reason: 'refusal' },
      ]);
      expect(reply).toMatchObject({ mode: 'refusal', reply: '이 요청은 처리할 수 없습니다.' });
      expect(JSON.stringify(reply)).not.toContain('REFUSAL-BODY-TEXT-431');
    });
  },
);

describe('어댑터 상한 (AC-229 ①)', () => {
  it('ChatAnthropic 인스턴스: maxTokens=env, maxRetries=1, clientOptions.timeout=env', () => {
    const model = createAnthropicChatModel(KEY, 'claude-opus-5-5', {
      maxTokens: 777,
      timeoutMs: 20_000,
    }) as unknown as {
      maxTokens: number;
      caller: { maxRetries: number };
      clientOptions: { timeout: number };
    };
    expect(model.maxTokens).toBe(777);
    // 재시도는 LangChain AsyncCaller 가 한다 (SDK 호출 자체는 maxRetries 0)
    expect(model.caller.maxRetries).toBe(1);
    expect(model.clientOptions.timeout).toBe(20_000);
  });
});

describe('서버측 폴백 적용 모델 (PR-B QA M-1, 공식 문서 2026-09-30)', () => {
  it('fallbacks 는 공식 지원 모델(Opus 5.5·Sonnet 5.5·Opus 5)에만, 레거시 Sonnet 5·Haiku 4.5 요청 본문·헤더에는 없다', async () => {
    const supported = LLM_MODELS.anthropic
      .filter((model) => model.anthropic?.serverFallback)
      .map((model) => model.id);
    expect(supported).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5']);
    for (const modelId of ['claude-sonnet-5', 'claude-haiku-4-5']) {
      const { requests } = await runWith(modelId, [FINAL_ROUND]);
      expect(requests[0]!.body).not.toHaveProperty('fallbacks');
      expect(requests[0]!.headers['anthropic-beta'] ?? '').not.toContain('server-side-fallback');
      // r4 AC-231 ⑥: 다른 베타가 없으므로 헤더 자체가 없고 엔드포인트는 베타가 아닌 /v1/messages
      expect(requests[0]!.headers).not.toHaveProperty('anthropic-beta');
      expect(requests[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    }
  });
});
