// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildChatGraph } from '@/server/chat/graph/build';
import { LLM_ERROR_NOTICE } from '@/server/chat/graph/messages';
import { streamChat } from '@/server/chat/graph/stream';
import type { ChatReplyOut, ChatRuntime } from '@/server/chat/graph/types';
import type { ResponsesProfile } from '@/server/llm/vendors/openai-chat';
import { createXaiChatModel, xai, XAI_PROFILE } from '@/server/llm/vendors/xai';

import { createXaiStub, XAI_LIVE_SEARCH_410, type XaiTurn } from '../../fixtures/chat/xai-http';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { expectNoSecret } from '../../helpers/secret';

/**
 * PRAMI-003 §4.7.7 B-1 수정 계약 (AC-368) — 실제 xAI 어댑터 + 전송 가로채기(실벤더 호출 0).
 * ① `search_parameters` 미전송(스텁은 실 API 처럼 이 키가 있으면 410) ② 410·deprecated → request_rejected + error 로그
 * ④ 요청 가드(금지 키 강제 주입 → 전송 0) ⑤ 응답 사후 검사(usage 서버측 도구 사용 → 출력 폐기·규칙 답).
 */
const KEY = 'xai-test-PRAMI003-live-search-00000000000001';
const QUESTION = 'XAI-B1-QUESTION Wapples-500 가격 알려줘';
const ANSWER = 'XAI-B1-MODEL-TEXT Wapples-500 은 두 모델이 있습니다.';
/** 문장 2개 — 토큰 가드는 마지막 문장을 턴 끝까지 보류하므로 첫 문장이 완료 이벤트 전에 나간다(discard 경로) */
const LONG_ANSWER = 'XAI-B1-MODEL-TEXT 첫 번째 문장입니다. 두 번째 문장도 있습니다.';
const SCENARIO: XaiTurn[] = [
  { toolCall: { name: 'price_lookup', args: { query: 'Wapples-500', family: null } } },
  { text: ANSWER },
];
/** 410 본문 원문 조각 — 로그·응답·SSE 어디에도 없어야 한다 */
const VENDOR_FRAGMENTS = ['Live search', 'Agent Tools', 'docs.x.ai', 'deprecated.'];

let ctx: ChatTestDb;
beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});
afterEach(() => vi.restoreAllMocks());

type Line = { level: string; text: string };

function captureLogs() {
  const lines: Line[] = [];
  for (const level of ['info', 'warn', 'error', 'log'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push({ level, text: args.map(String).join(' ') });
    });
  }
  const llmErrors = () =>
    lines
      .filter((line) => line.text.includes('"event":"chat.llm_error"'))
      .map((line) => ({
        level: line.level,
        entry: JSON.parse(line.text) as Record<string, unknown>,
      }));
  return { lines, llmErrors };
}

async function xaiRuntime(
  turns: XaiTurn[],
  modelId = 'grok-4.7',
  profile: ResponsesProfile = XAI_PROFILE,
  stubOptions: { chunked?: boolean } = {},
) {
  const stub = createXaiStub(turns, stubOptions);
  const runtime = scriptedRuntime(ctx.handle, { status: 'ready', vendor: 'xai', modelId });
  const credential = await runtime.resolveCredential();
  runtime.resolveCredential = async () => ({
    ...credential,
    vendorLabel: 'xAI (Grok)',
    createModel: (options) =>
      createXaiChatModel(KEY, modelId, { ...options, fetch: stub.fetch }, profile),
  });
  return { runtime, stub };
}

type Run = { reply: ChatReplyOut; raw: string };

async function run(runtime: ChatRuntime, streaming: boolean): Promise<Run> {
  if (!streaming) return { reply: await ask(runtime, QUESTION), raw: '' };
  const input = {
    text: QUESTION,
    truncated: false,
    history: [],
    actor: { userId: ctx.userId, role: 'USER' as const },
  };
  const raw = await new Response(streamChat(buildChatGraph(), input, runtime)).text();
  return { reply: JSON.parse(/event: final\ndata: (.*)/.exec(raw)![1]!) as ChatReplyOut, raw };
}

function sseEvents(raw: string) {
  return [...raw.matchAll(/event: (\w+)\ndata: (.*)/g)].map(([, event, data]) => ({
    event: event!,
    data: JSON.parse(data!) as Record<string, unknown>,
  }));
}

const MODES = [false, true] as const;

describe('AC-368 ① search_parameters 미전송 — 실 API 처럼 키가 있으면 410 을 주는 스텁에서 정상 답', () => {
  it.each(['grok-4.7', 'grok-4.3'] as const)('%s × JSON·SSE → mode llm', async (modelId) => {
    for (const streaming of MODES) {
      const { runtime, stub } = await xaiRuntime(SCENARIO, modelId);
      const { reply } = await run(runtime, streaming);
      expect(reply, `stream=${streaming}`).toMatchObject({ mode: 'llm', reply: ANSWER });
      expect(stub.requests).toHaveLength(2);
      for (const request of stub.requests) {
        expect(request.body).not.toHaveProperty('search_parameters');
        expect(request.body).not.toHaveProperty('max_turns');
      }
    }
  });

  it('프로필 상수에 search_parameters·max_turns 가 없다', () => {
    expect(XAI_PROFILE.modelKwargs).not.toHaveProperty('search_parameters');
    expect(XAI_PROFILE.modelKwargs).not.toHaveProperty('max_turns');
  });
});

describe('AC-368 ② 410 Live search deprecated → request_rejected · error 로그 · 원문 0', () => {
  it.each(MODES)('stream=%s', async (streaming) => {
    const logs = captureLogs();
    const { runtime } = await xaiRuntime([{ error: { status: 410, body: XAI_LIVE_SEARCH_410 } }]);
    const { reply, raw } = await run(runtime, streaming);
    expect(reply.mode).toBe('rule');
    expect(reply.notice).toContain(LLM_ERROR_NOTICE);
    expect(runtime.markRejected).not.toHaveBeenCalled();
    const [line] = logs.llmErrors();
    expect(line?.level).toBe('error');
    expect(line?.entry).toMatchObject({
      code: 'request_rejected',
      source: 'http',
      httpStatus: 410,
      vendorErrorCode: 'deprecated',
      vendor: 'xai',
      adapter: '@langchain/openai@1.6.0',
      stream: streaming,
    });
    const everything = [JSON.stringify(reply), raw, ...logs.lines.map((l) => l.text)].join('\n');
    for (const fragment of VENDOR_FRAGMENTS) expect(everything).not.toContain(fragment);
    expectNoSecret(everything, KEY, '410 응답·SSE·로그');
  });
});

describe('AC-368 ③ 폐기 고정 패턴은 상태 매핑을 바꾸지 않고 vendorErrorCode 만 deprecated', () => {
  it.each<[string, number, Record<string, unknown>, string, string]>([
    [
      '400 invalid-argument + deprecated',
      400,
      { code: 'invalid-argument', error: 'Parameter foo is deprecated' },
      'request_rejected',
      'deprecated',
    ],
    [
      '400 invalid-argument (패턴 없음)',
      400,
      { code: 'invalid-argument', error: 'Check your request body' },
      'request_rejected',
      'invalid-argument',
    ],
    [
      '404 + deprecation',
      404,
      { code: 'not-found', error: 'Model deprecation: use grok-4.7' },
      'model_not_found',
      'deprecated',
    ],
  ])('%s → %s', async (_label, status, body, code, vendorErrorCode) => {
    const logs = captureLogs();
    const { runtime } = await xaiRuntime([{ error: { status, body } }]);
    await ask(runtime, QUESTION);
    const [line] = logs.llmErrors();
    expect(line?.entry).toMatchObject({ code, httpStatus: status, vendorErrorCode });
    expect(line?.level).toBe(vendorErrorCode === 'deprecated' ? 'error' : 'warn');
    const text = logs.lines.map((l) => l.text).join('\n');
    expect(text).not.toContain(String(body.error));
  });
});

describe('AC-368 ④ 요청 가드 — 금지 키를 강제로 넣으면 전송 0 · 규칙 답 · source local · frame xai_request_guard', () => {
  const polluted = (extra: Record<string, unknown>): ResponsesProfile => ({
    ...XAI_PROFILE,
    modelKwargs: { ...XAI_PROFILE.modelKwargs, ...extra },
  });

  it.each<[string, ResponsesProfile]>([
    ['search_parameters', polluted({ search_parameters: { mode: 'off' } })],
    ['max_turns', polluted({ max_turns: 2 })],
    ['서버측 도구 web_search', polluted({ tools: [{ type: 'web_search' }] })],
  ])('%s', async (_label, profile) => {
    for (const streaming of MODES) {
      const logs = captureLogs();
      const { runtime, stub } = await xaiRuntime(SCENARIO, 'grok-4.7', profile);
      const { reply } = await run(runtime, streaming);
      expect(stub.requests, `stream=${streaming}`).toHaveLength(0);
      expect(reply.mode).toBe('rule');
      expect(reply.notice).toContain(LLM_ERROR_NOTICE);
      const [line] = logs.llmErrors();
      expect(line?.entry).toMatchObject({
        code: 'llm_error',
        source: 'local',
        frame: 'xai_request_guard',
        vendor: 'xai',
        // PR #26 L-b: 가드 차단은 재시도하지 않는다 — 시도 1회(전송은 0, 위 stub.requests)
        attempts: 1,
      });
      expect(line?.level).toBe('error');
      vi.restoreAllMocks();
    }
  });
});

/**
 * SSE 결과: 서버측 도구 출력 항목은 텍스트보다 먼저 와서 즉시 끊긴다 → SSE 에 모델 텍스트 0.
 * usage 만으로 판정되면 완료 이벤트 전에 나간 토큰은 discard(reason llm_error)로 폐기하고 final 은 규칙 답
 * (점진 스트리밍 유지 — Main 결정 A, AC-368 ⑤ 편차로 PR 본문 기록).
 */
function expectSseOutcome(raw: string, itemFirst: boolean) {
  if (itemFirst) {
    expect(raw).not.toContain('XAI-B1-MODEL-TEXT');
    return;
  }
  const events = sseEvents(raw);
  const names = events.map((e) => e.event);
  const leaked = events.some(
    (e) => e.event === 'token' && String(e.data.text).includes('XAI-B1-MODEL-TEXT'),
  );
  expect(leaked, '청크 스텁에서 완료 이벤트 전 토큰이 나간다(discard 경로 확인)').toBe(true);
  expect(names.filter((name) => name === 'discard')).toHaveLength(1);
  expect(names.lastIndexOf('token')).toBeLessThan(names.indexOf('discard'));
  expect(names.indexOf('discard')).toBeLessThan(names.indexOf('final'));
  expect(events.find((e) => e.event === 'discard')!.data).toEqual({ reason: 'llm_error' });
}

describe('AC-368 ⑤ 응답 사후 검사 — 서버측 도구 사용이면 모델 출력 폐기 · 규칙 답 · server_tool_used', () => {
  it.each<[string, XaiTurn]>([
    [
      'usage.num_server_side_tools_used=1',
      { text: LONG_ANSWER, usage: { num_server_side_tools_used: 1 } },
    ],
    ['usage.num_sources_used=3', { text: LONG_ANSWER, usage: { num_sources_used: 3 } }],
    ['서버측 도구 출력 항목(web_search_call)', { text: LONG_ANSWER, serverToolItem: true }],
  ])('%s (JSON·SSE)', async (_label, turn) => {
    for (const streaming of MODES) {
      const logs = captureLogs();
      // SSE 는 이벤트별 청크(텍스트 델타가 완료 이벤트보다 먼저 도착) — 실 네트워크 순서
      const { runtime } = await xaiRuntime([turn], 'grok-4.7', XAI_PROFILE, { chunked: true });
      const { reply, raw } = await run(runtime, streaming);
      expect(reply.mode, `stream=${streaming}`).toBe('rule');
      expect(JSON.stringify(reply)).not.toContain('XAI-B1-MODEL-TEXT');
      const [line] = logs.llmErrors();
      expect(line?.level).toBe('error');
      expect(line?.entry).toMatchObject({
        code: 'llm_error',
        source: 'response',
        httpStatus: 200,
        vendorErrorType: 'server_tool_used',
        vendor: 'xai',
        stream: streaming,
      });
      if (streaming) expectSseOutcome(raw, 'serverToolItem' in turn);
      vi.restoreAllMocks();
    }
  });

  it.each<[string, XaiTurn]>([
    [
      'usage 서버측 도구 0',
      { text: ANSWER, usage: { num_server_side_tools_used: 0, num_sources_used: 0 } },
    ],
    ['usage 필드 없음', { text: ANSWER }],
  ])('%s → 정상 답 (JSON·SSE)', async (_label, turn) => {
    for (const streaming of MODES) {
      const logs = captureLogs();
      const { runtime } = await xaiRuntime([turn], 'grok-4.7', XAI_PROFILE, { chunked: true });
      const { reply } = await run(runtime, streaming);
      expect(reply).toMatchObject({ mode: 'llm', reply: ANSWER });
      expect(logs.llmErrors()).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });
});

describe('AC-368 ⑥ 키 검증은 GET /v1/models 1건 (채팅 프로브 없음)', () => {
  it('검증 요청 빌더 = GET https://api.x.ai/v1/models + Bearer 헤더, 본문 없음', () => {
    const request = xai.verifyRequest(KEY);
    expect(request.url).toBe('https://api.x.ai/v1/models');
    expect(request.headers).toEqual({ authorization: `Bearer ${KEY}` });
    expect(request.url).not.toContain(KEY);
  });
});
