// @vitest-environment node
import { ToolMessage } from '@langchain/core/messages';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MISSING_MESSAGE } from '@/server/chat/graph/messages';
import { respondToChat } from '@/server/chat/respond';

import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * 그래프 경로 (PRAMI-002 §4.3.3, ScriptedChatModel + PGlite 판매단가 픽스처):
 * AC-222 미등록 안내·규칙 폴백, AC-223 오류별 안내, AC-224 ②③ 도구 이식, AC-229 상한, AC-230 ① 히스토리, AC-232 킬스위치·폴백.
 */
let ctx: ChatTestDb;

beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);

afterAll(async () => {
  await ctx.handle.close();
});

describe('미등록·킬스위치·폴백 (AC-222·232)', () => {
  it('키 없음: 규칙 답(AC-80 ① 후보 병기) + mode=rule + setup=missing, LLM 호출 0', async () => {
    const runtime = scriptedRuntime(ctx.handle);
    const reply = await ask(runtime, 'Wapples-500 가격');
    const rule = await respondToChat(ctx.handle.db, { role: 'USER' }, 'Wapples-500 가격');
    expect(reply).toMatchObject({
      mode: 'rule',
      reply: rule.reply,
      candidates: rule.candidates,
      llm: { status: 'missing', vendor: null, model: null },
      setup: { status: 'missing', message: MISSING_MESSAGE, href: '/settings#llm' },
    });
    expect(runtime.llmCalls).toBe(0);
  });

  it('CHAT_LLM_ENABLED=false: 키가 있어도 mode=rule, 안내 없음, 자격 증명 조회 없음', async () => {
    const model = new ScriptedChatModel([{ text: '호출되면 안 됨' }]);
    const runtime = scriptedRuntime(ctx.handle, { model, settings: { llmEnabled: false } });
    const reply = await ask(runtime, 'Wapples-500 가격');
    expect(reply).toMatchObject({ mode: 'rule', llm: { status: 'disabled' } });
    expect(reply.setup).toBeUndefined();
    expect(runtime.resolveCredential).not.toHaveBeenCalled();
    expect(model.calls).toHaveLength(0);
  });

  it('CHAT_RULE_FALLBACK=false + 키 없음: 안내만(mode=setup), 규칙 답 없음', async () => {
    const runtime = scriptedRuntime(ctx.handle, { settings: { ruleFallback: false } });
    const reply = await ask(runtime, 'Wapples-500 가격');
    expect(reply).toMatchObject({ mode: 'setup', reply: MISSING_MESSAGE, candidates: [] });
    expect(reply.reply).not.toContain('12,000,000');
  });

  it.each(['invalid', 'forbidden', 'unreadable'] as const)(
    '자격 증명 %s → setupGuide 안내 + 규칙 답 (LLM 호출 0)',
    async (status) => {
      const runtime = scriptedRuntime(ctx.handle, { status });
      const reply = await ask(runtime, 'Wapples-500 가격');
      expect(reply).toMatchObject({ mode: 'rule', setup: { status } });
      expect(reply.setup!.message).toContain('Anthropic (Claude)');
      expect(runtime.llmCalls).toBe(0);
    },
  );
});

describe('LLM 경로·도구 이식 (AC-222 ready·AC-224 ②③)', () => {
  it('price_lookup(Wapples-500) → candidates 2건(가격 포함), 응답 아티팩트는 규칙 경로와 같은 형태', async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'price_lookup', args: { query: 'Wapples-500', family: null } }] },
      { text: 'Wapples-500 은 두 모델이 있습니다.' },
    ]);
    const runtime = scriptedRuntime(ctx.handle, { model });
    const reply = await ask(runtime, 'Wapples-500 가격 알려줘');
    const tool = model.calls[1]!.messages.at(-1) as ToolMessage;
    const data = JSON.parse(String(tool.content)) as {
      status: string;
      items: { itemName: string; price: unknown }[];
    };
    expect(data.status).toBe('candidates');
    expect(data.items).toHaveLength(2);
    expect(data.items.every((item) => item.price !== null)).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/Wapples-5000|MS-Std/);
    const rule = await respondToChat(ctx.handle.db, { role: 'USER' }, 'Wapples-500 가격');
    expect(reply).toMatchObject({ mode: 'llm', intent: 'price', llm: { status: 'ready' } });
    expect(reply.candidates).toEqual(rule.candidates);
    expect(runtime.markUsed).toHaveBeenCalledTimes(1);
  });

  it('품번 → found 1건 + 견적 action, 제품군만 → too_many 가격 없이 ≤5건', async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'price_lookup', args: { query: 'P10100024', family: null } }] },
      { toolCalls: [{ name: 'price_lookup', args: { query: 'Wapples', family: null } }] },
      { text: '확인했습니다.' },
    ]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), 'P10100024 와 Wapples 목록');
    const first = JSON.parse(String((model.calls[1]!.messages.at(-1) as ToolMessage).content));
    const second = JSON.parse(String((model.calls[2]!.messages.at(-1) as ToolMessage).content));
    expect(first).toMatchObject({ status: 'found', items: [{ itemCode: 'P10100024' }] });
    expect(second.status).toBe('too_many');
    expect(second.items.length).toBeLessThanOrEqual(5);
    expect(second.items.every((item: { price: unknown }) => item.price === null)).toBe(true);
    expect(reply.action).toMatchObject({ href: '/calculator?family=WAPPLES&item=P10100024' });
    expect(reply.candidates.length).toBeGreaterThanOrEqual(4);
  });

  it('price_compare_previous · quote_start 도 도구로 실행되고 intent 가 반영된다', async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'quote_start', args: { query: null, family: 'WAPPLES' } }] },
      { text: '견적 계산기를 여세요.' },
    ]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), '와플즈 견적 시작해줘');
    expect(reply).toMatchObject({
      intent: 'quote',
      action: { href: '/calculator?family=WAPPLES' },
    });
    const compare = new ScriptedChatModel([
      { toolCalls: [{ name: 'price_compare_previous', args: { query: 'Wapples-500 T2' } }] },
      { text: '비교했습니다.' },
    ]);
    const compared = await ask(scriptedRuntime(ctx.handle, { model: compare }), '가격 변동');
    expect(compared.intent).toBe('compare');
  });
});

describe('벤더 오류별 안내 (AC-223)', () => {
  const marker = 'VENDOR-RAW-MESSAGE-XYZ';
  it.each([
    [{ status: 401, lc_error_code: 'MODEL_AUTHENTICATION' }, 'invalid', true],
    [
      { status: 400, error: { error: { details: [{ reason: 'API_KEY_INVALID' }] } } },
      'invalid',
      true,
    ],
    [{ status: 403 }, 'forbidden', true],
    [{ status: 404, lc_error_code: 'MODEL_NOT_FOUND' }, 'model_not_found', true],
    [{ status: 429 }, 'rate_limited', true],
    [{ status: 503 }, 'unavailable', true],
    [{ name: 'TimeoutError' }, 'unavailable', true],
  ] as const)(
    '%o → setup.status=%s, 규칙 답, 벤더 원문 없음, HTTP 계약 유지',
    async (error, status, rule) => {
      const model = new ScriptedChatModel([{ throw: { ...error, message: marker } }]);
      const runtime = scriptedRuntime(ctx.handle, { model });
      const reply = await ask(runtime, 'Wapples-500 가격');
      expect(reply.setup?.status).toBe(status);
      if (rule)
        expect(reply).toMatchObject({ mode: 'rule', candidates: expect.any(Array) as unknown[] });
      expect(JSON.stringify(reply)).not.toContain(marker);
      const authStatus = status === 'invalid' || status === 'forbidden' ? status : null;
      if (authStatus)
        expect(runtime.markRejected).toHaveBeenCalledWith(expect.anything(), authStatus);
      else expect(runtime.markRejected).not.toHaveBeenCalled();
      if (status === 'model_not_found') expect(reply.setup!.message).toContain('Claude Opus 5.5');
    },
  );

  it('refusal → 거부 문구(mode=refusal), content 는 응답에 없다', async () => {
    const model = new ScriptedChatModel([{ refusal: 'REFUSAL-CONTENT-777' }]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), '위험한 질문');
    expect(reply).toMatchObject({ mode: 'refusal', reply: '이 요청은 처리할 수 없습니다.' });
    expect(JSON.stringify(reply)).not.toContain('REFUSAL-CONTENT-777');
  });
});

describe('상한 (AC-229)', () => {
  it('도구 5연속 요청 → 4번 실행 후 중단, 범위 안내 notice, LLM 호출 ≤5', async () => {
    const lookup = {
      toolCalls: [{ name: 'price_lookup', args: { query: 'Wapples-500', family: null } }],
    };
    const model = new ScriptedChatModel([lookup, lookup, lookup, lookup, lookup, { text: '끝' }]);
    const runtime = scriptedRuntime(ctx.handle, { model });
    const reply = await ask(runtime, 'Wapples-500 가격');
    expect(runtime.llmCalls).toBe(5);
    expect(model.calls).toHaveLength(5);
    const toolMessages = model.calls
      .at(-1)!
      .messages.filter((message) => message instanceof ToolMessage);
    expect(toolMessages).toHaveLength(4);
    expect(reply.notice).toContain('질문 범위가 넓어 일부만 확인했습니다.');
  });

  it('모델 호출이 타임아웃(2000ms)을 넘기면 unavailable + 규칙 답', async () => {
    const model = new ScriptedChatModel([{ delayMs: 10_000 }]);
    const runtime = scriptedRuntime(ctx.handle, { model, settings: { timeoutMs: 300 } });
    const started = Date.now();
    const reply = await ask(runtime, 'Wapples-500 가격');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(reply).toMatchObject({ mode: 'rule', setup: { status: 'unavailable' } });
  });
});

describe('히스토리 (AC-230 ①)', () => {
  it('11턴 → 최근 10턴만 텍스트로 모델 페이로드에 포함, 시스템 프롬프트 1개, 마지막은 이번 질문', async () => {
    const model = new ScriptedChatModel([{ text: '네' }]);
    const history = Array.from({ length: 11 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `턴-${index}`,
    }));
    await ask(scriptedRuntime(ctx.handle, { model }), '이번 질문', { history });
    const sent = model.calls[0]!.messages;
    expect(sent).toHaveLength(1 + 10 + 1);
    expect(sent[0]!.getType()).toBe('system');
    expect(sent.map((message) => String(message.content))).not.toContain('턴-0');
    expect(String(sent.at(-1)!.content)).toBe('이번 질문');
    expect(sent.at(-1)!.getType()).toBe('human');
  });
});
