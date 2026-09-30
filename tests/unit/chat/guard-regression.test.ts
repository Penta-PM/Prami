// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { salesPrices } from '@/db/schema';
import { createTokenGuard, guardReplyText, normalizeForGuard } from '@/server/chat/graph/guard';
import { COST_REPLY_USER } from '@/server/chat/respond';

import { ScriptedChatModel } from '../../fixtures/chat/scripted-model';
import { ask, scriptedRuntime, setupChatDb, type ChatTestDb } from '../../helpers/chat';

/**
 * 출력 가드 회귀 (PRAMI-002 §4.4.3, PR-B QA L-1·L-2 재현 케이스).
 * L-1 회피 변형(제로폭·전각 숫자·한글 수사·비율·텍스트 속 원가 키 JSON)은 교체, 원가 단어 없는 판매가는 그대로.
 * L-2 규칙 경로(품명에 가드 단어)는 가드 대상이 아니다 — 정상 가격 답이 유지된다.
 */
const base = { role: 'USER' as const, vendor: 'anthropic', model: 'm' };
const guarded = (text: string) => guardReplyText({ ...base, text });

describe('L-1 회피 변형', () => {
  it.each([
    ['제로폭 문자', '원\u200b가는 1,000원입니다.'],
    ['제로폭 결합자', '원\u2060가: 1,000원'],
    ['전각 숫자', '원가는 １，０００원입니다.'],
    ['한글 수사', '원가는 오천만 원입니다.'],
    ['단위 붙은 숫자', '매입 단가는 1.2억원 수준입니다.'],
    ['영문 margin 비율', 'Our margin is 35%.'],
    ['마진 퍼센트', '마진은 30퍼센트입니다.'],
    ['텍스트 속 원가 키 JSON', '{"unit_cost":1000,"material_code":"M-1"}'],
    ['따옴표 없는 키', 'unitCost = 1000'],
  ])('%s → 역할별 거부 문구', (_label, text) => {
    expect(guarded(text)).toBe(COST_REPLY_USER);
  });

  it('원가 단어 없는 판매가·할인율은 그대로 (오탐 없음)', () => {
    for (const text of [
      'Wapples-500 판매가는 오천만 원입니다.',
      '정가 대비 할인율 10%를 적용할 수 있습니다.',
      '판매단가는 １２,０００,０００원입니다.',
    ]) {
      expect(guarded(text)).not.toBe(COST_REPLY_USER);
    }
  });

  it('normalizeForGuard: NFKC + 제로폭 제거', () => {
    expect(normalizeForGuard('원\u200b가 １２３')).toBe('원가 123');
  });
});

describe('스트리밍 토큰 가드 (PR-C 자체 보안 리뷰)', () => {
  it('완성된 문장만 내보내고, 원가+금액 문장이 나오면 이후 전부 막는다', () => {
    const guard = createTokenGuard();
    expect(guard.push('판매가를 ')).toBe('');
    expect(guard.push('확인했습니다. 원가는 ')).toBe('판매가를 확인했습니다.');
    expect(guard.push('1,000원입니다. ')).toBe('');
    expect(guard.blocked).toBe(true);
    expect(guard.push(' 다음 문장. ')).toBe('');
    expect(guard.flush()).toBe('');
  });

  it('금액이 다음 청크로 쪼개져 와도, 제로폭·전각 변형이어도 막는다', () => {
    const split = createTokenGuard();
    expect(split.push('마진은 ')).toBe('');
    expect(split.push('30')).toBe('');
    expect(split.push('%입니다. ')).toBe('');
    expect(split.blocked).toBe(true);
    const evasive = createTokenGuard();
    expect(evasive.push('원\u200b가: １，０００원. ')).toBe('');
    expect(evasive.blocked).toBe(true);
  });

  it('소수점 금액(1.2억원)은 청크 끝의 "." 에서 문장을 끊지 않는다', () => {
    const guard = createTokenGuard();
    expect(guard.push('매입 단가는 1.')).toBe('');
    expect(guard.push('2억원 수준입니다. ')).toBe('');
    expect(guard.blocked).toBe(true);
  });

  it('원가 단어 없는 답은 문장 단위로 흐르고, 마지막 조각은 flush 로 나온다', () => {
    const guard = createTokenGuard();
    expect(guard.push('두 모델이 있습니다.\n가격은 12,000,000원')).toBe('두 모델이 있습니다.\n');
    expect(guard.push('입니다.')).toBe('');
    expect(guard.flush()).toBe('가격은 12,000,000원입니다.');
    expect(guard.blocked).toBe(false);
  });

  it('addTerms: 도구 결과 품명은 토큰 판정에서도 가린다 (compose 가드와 같은 기준)', () => {
    const guard = createTokenGuard();
    guard.addTerms(['Cost Saver Pack']);
    expect(guard.push('Cost Saver Pack 판매가는 3,300,000원입니다. ')).toBe(
      'Cost Saver Pack 판매가는 3,300,000원입니다.',
    );
    expect(guard.blocked).toBe(false);
  });

  it('flush 도 같은 판정 — 마지막 조각의 원가 금액은 막는다', () => {
    const guard = createTokenGuard();
    expect(guard.push('참고로 원가는 5만원입니다.')).toBe('');
    expect(guard.flush()).toBe('');
    expect(guard.blocked).toBe(true);
  });
});

describe('L-2 규칙 경로는 가드 대상 아님 · AC-247 그래프 경로', () => {
  let ctx: ChatTestDb;
  beforeAll(async () => {
    ctx = await setupChatDb();
    const row: typeof salesPrices.$inferInsert = {
      sourceId: 99201,
      productFamily: 'D.AMO',
      itemCode: 'PGUARD01',
      itemName: '원가절감 패키지 margin edition',
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
    };
    // AC-247 ⑧: 도구 아티팩트 품명에 cost 가 든 품목 (LLM 경로)
    await ctx.handle.db
      .insert(salesPrices)
      .values([
        row,
        { ...row, sourceId: 99202, itemCode: 'PGUARD02', itemName: 'Cost Saver Pack' },
      ]);
  }, 120_000);
  afterAll(async () => {
    await ctx.handle.close();
  });

  it('품명에 가드 단어가 든 품목의 규칙 답(가격)은 거부 문구로 바뀌지 않는다', async () => {
    const reply = await ask(scriptedRuntime(ctx.handle), 'PGUARD01');
    expect(reply.mode).toBe('rule');
    expect(reply.reply).toContain('3,300,000원');
    expect(reply.reply).not.toBe(COST_REPLY_USER);
  });

  it('같은 문장을 LLM 이 만들면 가드가 교체한다 (LLM 경로는 계속 보호)', async () => {
    const model = new ScriptedChatModel([{ text: '원가절감 패키지 원가는 3,300,000원입니다.' }]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), '가격');
    expect(reply).toMatchObject({ mode: 'llm', reply: COST_REPLY_USER });
  });

  it.each([
    ['① 제로폭', '원\u200b가는 1,000원입니다.'],
    ['② 전각 숫자', '원가는 １，０００원입니다.'],
    ['③ 한글 수사', '원가는 오천만 원입니다.'],
    ['④ margin 비율', 'margin is about 35%.'],
    ['④ 이익률', '이익률은 35%입니다.'],
    ['⑤ 텍스트 속 키', '참고: {"unit_cost": 1000}'],
  ])('AC-247 %s → LLM 경로에서 역할별 거부 문구로 교체', async (_label, text) => {
    const model = new ScriptedChatModel([{ text }]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), '가격');
    expect(reply).toMatchObject({ mode: 'llm', reply: COST_REPLY_USER });
  });

  it('AC-247 ⑥ 숫자 없는 원가 언급은 교체하지 않고 모델 출력과 바이트 동일', async () => {
    const text = '원가는 챗봇에서 제공하지 않습니다.';
    const model = new ScriptedChatModel([{ text }]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), '가격');
    expect(reply.mode).toBe('llm');
    expect(reply.reply).toBe(text);
  });

  it('AC-247 ⑧ 도구 결과 품명에 cost 가 든 품목의 가격 문장은 교체하지 않는다 (판정용 사본만 마스킹)', async () => {
    const text = 'Cost Saver Pack(PGUARD02) 판매가는 3,300,000원입니다.';
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'price_lookup', args: { query: 'PGUARD02', family: null } }] },
      { text },
    ]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), 'PGUARD02 가격 알려줘');
    expect(reply).toMatchObject({ mode: 'llm', intent: 'price' });
    expect(reply.reply).toBe(text);
  });

  it('AC-247 ⑧ 품명을 가려도 품명 밖의 원가 금액 문장은 교체한다', async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: 'price_lookup', args: { query: 'PGUARD02', family: null } }] },
      { text: 'Cost Saver Pack 의 원가는 1,000,000원입니다.' },
    ]);
    const reply = await ask(scriptedRuntime(ctx.handle, { model }), 'PGUARD02 가격 알려줘');
    expect(reply).toMatchObject({ mode: 'llm', reply: COST_REPLY_USER });
  });
});
