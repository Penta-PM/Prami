// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import { recursionLimitFor } from '@/server/chat/graph/run';
import { createAnthropicChatModel } from '@/server/llm/vendors/anthropic-chat';

import {
  createAnthropicStub,
  thinkingBlock,
  toolUseBlock,
} from '../../fixtures/chat/anthropic-http';
import { scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { expectNoSecret } from '../../helpers/secret';

/**
 * AC-228 키 격리 (PRAMI-002 I-3): LLM 경로 1회를 streamMode ['updates','debug','messages','values'] 로 모두 수집해 직렬화하고,
 * 최종 상태·ChatRuntime 직렬화와 함께 검사하면 키 K 노출이 없다(전체 + 12자 창). 실제 ChatAnthropic + 전송 계층 스텁.
 */
const KEY = 'sk-ant-api03-test-ISOLATION-9f8e7d6c5b4a3210';
let ctx: ChatTestDb;

beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);

afterAll(async () => {
  await ctx.handle.close();
});

/** 순환·함수·DB 핸들을 건너뛰는 직렬화 (JSON.stringify 로 바깥에 나갈 수 있는 모든 값) */
function serialize(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (key, entry: unknown) => {
    if (typeof entry === 'function') return `[fn ${key}]`;
    if (typeof entry === 'bigint') return String(entry);
    if (entry && typeof entry === 'object') {
      if (seen.has(entry)) return '[cycle]';
      seen.add(entry);
    }
    return entry;
  });
}

describe('키 격리 (AC-228)', () => {
  it('모든 스트림 이벤트·최종 상태·런타임 직렬화에 K 가 없다, 키는 HTTP 헤더에만 있다', async () => {
    const stub = createAnthropicStub([
      {
        content: [
          thinkingBlock('도구 호출'),
          toolUseBlock('toolu_1', 'price_lookup', { query: 'Wapples-500', family: null }),
        ],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'text', text: '두 모델이 있습니다.' }], stop_reason: 'end_turn' },
    ]);
    const runtime = scriptedRuntime(ctx.handle, { status: 'ready' });
    const credential = await runtime.resolveCredential();
    runtime.resolveCredential = async () => ({
      ...credential,
      createModel: (options) =>
        createAnthropicChatModel(KEY, 'claude-opus-5-5', { ...options, fetch: stub.fetch }),
    });
    const graph = buildChatGraph();
    const chunks: unknown[] = [];
    const stream = await graph.stream(
      {
        input: { text: 'Wapples-500 가격 알려줘', truncated: false },
        history: [],
        actor: { userId: ctx.userId, role: 'USER' },
      },
      {
        configurable: { runtime },
        recursionLimit: recursionLimitFor(4),
        streamMode: ['updates', 'debug', 'messages', 'values'],
      },
    );
    for await (const chunk of stream) chunks.push(chunk);
    const final = chunks
      .filter((chunk) => Array.isArray(chunk) && chunk[0] === 'values')
      .at(-1) as [string, { reply: unknown }];
    expect(final[1].reply).toMatchObject({ mode: 'llm' });
    expect(chunks.length).toBeGreaterThan(10);
    expectNoSecret(serialize(chunks), KEY, '스트림 이벤트');
    expectNoSecret(serialize(final), KEY, '최종 상태');
    const { db: _db, ...runtimeWithoutDb } = runtime;
    void _db;
    expectNoSecret(serialize(runtimeWithoutDb), KEY, 'ChatRuntime');
    // 키가 실제로 쓰인 곳은 전송 헤더(x-api-key)뿐
    expect(stub.requests[0]!.headers['x-api-key']).toBe(KEY);
    expectNoSecret(serialize(stub.requests.map((request) => request.body)), KEY, '요청 본문');
  });
});
