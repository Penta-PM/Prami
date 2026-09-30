// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { salesPrices } from '@/db/schema';
import { buildChatGraph } from '@/server/chat/graph/build';
import { assertNoCostKeys } from '@/server/chat/graph/guard';
import { runChat } from '@/server/chat/graph/run';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatReplyOut, ChatRuntime } from '@/server/chat/graph/types';
import { COST_REPLY_USER } from '@/server/chat/respond';
import { defaultModelFor } from '@/server/llm/models';
import { createAnthropicChatModel } from '@/server/llm/vendors/anthropic-chat';
import { createGoogleChatModel } from '@/server/llm/vendors/google-chat';
import { createOpenAIChatModel } from '@/server/llm/vendors/openai-chat';

import { createAnthropicStub, toolUseBlock } from '../../fixtures/chat/anthropic-http';
import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';
import { createGeminiStub, createOpenAIStub } from '../../fixtures/chat/vendor-http';
import { scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { expectNoSecret } from '../../helpers/secret';

/**
 * AC-243 SSE 스트리밍 (PRAMI-002 §4.3.9): token ≥1 · 도구 사용 시 status · final(JSON 과 같은 ChatReply, 금지 키 없음) · done 순서,
 * 가드 교체본이 final, 클라이언트 중단 → 모델 호출 signal abort. 3벤더 어댑터 스트림에도 사용자 키·원가 키 없음.
 */
type SseEvent = { event: string; data: unknown };

async function readSse(
  stream: ReadableStream<Uint8Array>,
): Promise<{ events: SseEvent[]; raw: string }> {
  const raw = await new Response(stream).text();
  const events = raw
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? '';
      const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null') as unknown;
      return { event, data };
    });
  return { events, raw };
}

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
  // AC-247 ⑧ 스트림: 품명에 cost 가 든 품목
  await ctx.handle.db.insert(salesPrices).values({
    sourceId: 99301,
    productFamily: 'D.AMO',
    itemCode: 'PSTREAM01',
    itemName: 'Cost Saver Pack',
    unit: 'EA',
    priceType: '정상판매',
    priceCategory: '일반',
    currency: 'KRW',
    hasCorePrice: false,
    unitPrice: '3300000.00',
    effectiveFrom: '2026-01-01',
    appliesToAllCustomers: false,
    isFinalSource: true,
    baseCoreCount: 0,
    unitPricePerCore: '0.00',
    customerCode: '0',
    source: 'erp',
    operationStatus: '운영중',
  });
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});
afterEach(() => vi.unstubAllGlobals());

const input = (text: string) => ({
  text,
  truncated: false,
  history: [],
  actor: { userId: '00000000-0000-4000-8000-00000000000a', role: 'USER' as const },
});

const stream = (runtime: ChatRuntime, text: string, signal?: AbortSignal) =>
  readSse(streamChat(buildChatGraph(), input(text), runtime, signal));

describe('SSE 이벤트 순서·정본 (AC-243)', () => {
  it('도구 사용: status → token → final → done, final 은 JSON 경로와 같은 ChatReply·금지 키 없음', async () => {
    const script = () =>
      new ScriptedChatModel([
        { toolCalls: [{ name: 'price_lookup', args: { query: 'Wapples-500', family: null } }] },
        { text: 'Wapples-500 은 두 모델이 있습니다.' },
      ]);
    const { events } = await stream(
      scriptedRuntime(ctx.handle, { model: script() }),
      'Wapples-500 가격',
    );
    const names = events.map((event) => event.event);
    expect(names).toContain('status');
    expect(names).toContain('token');
    expect(names.slice(-2)).toEqual(['final', 'done']);
    expect(names.indexOf('status')).toBeLessThan(names.indexOf('final'));
    expect(events.find((event) => event.event === 'status')!.data).toEqual({
      label: '가격 조회 중',
    });
    const final = events.find((event) => event.event === 'final')!.data as ChatReplyOut;
    expect(() => assertNoCostKeys(final)).not.toThrow();
    const json = await runChat(
      buildChatGraph(),
      input('Wapples-500 가격'),
      scriptedRuntime(ctx.handle, { model: script() }),
    );
    expect(final).toEqual(json);
  });

  it('가드: 원가+금액 문장은 토큰으로도 나가지 않고(문장 단위 판정) final 이 교체본이다', async () => {
    const model = new ScriptedChatModel([
      {
        text: 'Wapples-500 판매가를 확인했습니다. 참고로 원가는 1,000원입니다. 추가 문의는 견적으로.',
      },
    ]);
    const { events, raw } = await stream(scriptedRuntime(ctx.handle, { model }), '가격 알려줘');
    const tokens = events
      .filter((event) => event.event === 'token')
      .map((event) => (event.data as { text: string }).text);
    expect(tokens.join('')).toBe('Wapples-500 판매가를 확인했습니다.');
    const final = events.find((event) => event.event === 'final')!.data as ChatReplyOut;
    expect(final.reply).toBe(COST_REPLY_USER);
    // SSE 전체(토큰 포함)에 원가 금액이 없다
    expect(raw).not.toContain('1,000원');
    expect(events.at(-1)!.event).toBe('done');
  });

  it('AC-247 ⑧: 도구 결과 품명(cost 포함)은 토큰 판정에서 가려져 가격 문장이 token 으로 흐른다', async () => {
    const text = 'Cost Saver Pack 판매가는 3,300,000원입니다.';
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'price_lookup', args: { query: 'PSTREAM01', family: null } }] },
      { text },
    ]);
    const { events } = await stream(scriptedRuntime(ctx.handle, { model }), 'PSTREAM01 가격');
    const tokens = events
      .filter((event) => event.event === 'token')
      .map((event) => (event.data as { text: string }).text)
      .join('');
    expect(tokens).toBe(text);
    expect((events.find((event) => event.event === 'final')!.data as ChatReplyOut).reply).toBe(
      text,
    );
  });

  it('규칙 경로(키 없음)도 final·done 으로 끝난다 (토큰 없음)', async () => {
    const { events } = await stream(scriptedRuntime(ctx.handle), 'Wapples-500 가격');
    expect(events.map((event) => event.event)).toEqual(['final', 'done']);
    expect((events[0]!.data as ChatReplyOut).mode).toBe('rule');
  });

  it('클라이언트 중단 → 모델 호출 signal 이 abort 되고 final 없이 끝난다', async () => {
    const model = new ScriptedChatModel([{ delayMs: 10_000 }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const started = Date.now();
    const { events } = await stream(
      scriptedRuntime(ctx.handle, { model }),
      '가격',
      controller.signal,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(model.observed.aborted).toBe(true);
    expect(events.map((event) => event.event)).not.toContain('final');
  });
});

const KEYS = {
  anthropic: 'sk-ant-api03-test-STREAM-anthropic-00000001',
  openai: 'sk-proj-test-STREAM-openai-00000000000000002',
  google: 'AIzaTestSTREAMgoogle00000000000000000003',
} as const;

function vendorStub(vendor: keyof typeof KEYS) {
  if (vendor === 'anthropic') {
    return createAnthropicStub([
      {
        content: [toolUseBlock('toolu_1', 'price_lookup', { query: 'Wapples-500', family: null })],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'text', text: '두 모델이 있습니다.' }], stop_reason: 'end_turn' },
    ]);
  }
  const turns = [
    { toolCall: { name: 'price_lookup', args: { query: 'Wapples-500', family: null } } },
    { text: '두 모델이 있습니다.' },
  ];
  return vendor === 'openai' ? createOpenAIStub(turns) : createGeminiStub(turns);
}

describe('3벤더 스트림 불변식 (AC-243·AC-225~228 확장)', () => {
  it.each(['anthropic', 'openai', 'google'] as const)(
    '%s: 스트리밍 요청 + token·final, SSE 전체·요청 URL/본문에 키 없음, final 금지 키 없음',
    async (vendor) => {
      const stub = vendorStub(vendor);
      if (vendor === 'google') vi.stubGlobal('fetch', stub.fetch);
      const factory = {
        anthropic: createAnthropicChatModel,
        openai: createOpenAIChatModel,
        google: createGoogleChatModel,
      }[vendor];
      const modelId = defaultModelFor(vendor)!;
      const runtime = scriptedRuntime(ctx.handle, { status: 'ready', vendor, modelId });
      const credential = await runtime.resolveCredential();
      runtime.resolveCredential = async () => ({
        ...credential,
        createModel: (options) => factory(KEYS[vendor], modelId, { ...options, fetch: stub.fetch }),
      });
      const { events, raw } = await stream(runtime, 'Wapples-500 가격');
      const names = events.map((event) => event.event);
      expect(names).toContain('token');
      expect(names.slice(-2)).toEqual(['final', 'done']);
      const final = events.find((event) => event.event === 'final')!.data as ChatReplyOut;
      expect(final).toMatchObject({ mode: 'llm', intent: 'price', reply: '두 모델이 있습니다.' });
      expect(() => assertNoCostKeys(final)).not.toThrow();
      expect(raw).not.toMatch(/unit_cost|material_code|material_costs/);
      expectNoSecret(raw, KEYS[vendor], `${vendor} SSE`);
      for (const request of stub.requests) {
        expectNoSecret(request.url + JSON.stringify(request.body), KEYS[vendor], `${vendor} 요청`);
      }
    },
    20_000,
  );
});
