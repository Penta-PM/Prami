// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { salesPrices } from '@/db/schema';
import { applyPolicy } from '@/server/imports/apply-policy';
import { PriceSchema, priceView } from '@/server/chat/features/shared';
import { priceLookupTool } from '@/server/chat/features/pricing';
import { latestChatPrice, type ChatPrice } from '@/server/chat/queries';
import { priceSentence, respondToChat } from '@/server/chat/respond';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/**
 * 챗봇 코어 단가 (D.AMO 코어 단가 스펙 §4 챗봇·§6): 코어 적용 행(Y + 기준 1 이상)만 PriceSchema 코어 키·규칙 응답 접미.
 * N 품목·Y + 기준 0(D4) 은 출력이 키까지 그대로다.
 */
const N_PRICE: ChatPrice = {
  itemCode: 'P1',
  itemName: 'Wapples-500 ',
  productFamily: 'WAPPLES',
  priceType: '정상판매',
  unitPrice: '12000000.00',
  currency: 'KRW',
  effectiveFrom: '2026-01-01',
  hasCorePrice: false,
  baseCoreCount: 0,
  unitPricePerCore: '0.00',
};
const CORE_PRICE: ChatPrice = {
  ...N_PRICE,
  itemName: 'D.AMO KE',
  productFamily: 'D.AMO',
  unitPrice: '10000000.00',
  hasCorePrice: true,
  baseCoreCount: 4,
  unitPricePerCore: '1500000.00',
};
const CORE_ZERO: ChatPrice = { ...CORE_PRICE, priceType: '조달', baseCoreCount: 0 };

describe('priceView — 코어 키는 코어 적용 행만', () => {
  it('N 행: 기존 4키 그대로 (코어 키 없음)', () => {
    const view = priceView(N_PRICE);
    expect(view).toStrictEqual({
      unitPrice: '12000000.00',
      currency: 'KRW',
      priceType: '정상판매',
      effectiveFrom: '2026-01-01',
    });
    expect(JSON.stringify(view)).toBe(
      '{"unitPrice":"12000000.00","currency":"KRW","priceType":"정상판매","effectiveFrom":"2026-01-01"}',
    );
    // N 인데 기준·1코어 단가 값이 남아 있어도 키가 없다
    expect(
      priceView({ ...N_PRICE, baseCoreCount: 4, unitPricePerCore: '1.00' }),
    ).not.toHaveProperty('baseCoreCount');
  });

  it('Y + 기준 0(조달, D4): 코어 키 없음', () => {
    const view = priceView(CORE_ZERO);
    expect(Object.keys(view)).toEqual(['unitPrice', 'currency', 'priceType', 'effectiveFrom']);
  });

  it('Y + 기준 4: baseCoreCount·unitPricePerCore 추가, strict 스키마 통과', () => {
    const view = priceView(CORE_PRICE);
    expect(view).toStrictEqual({
      unitPrice: '10000000.00',
      currency: 'KRW',
      priceType: '정상판매',
      effectiveFrom: '2026-01-01',
      baseCoreCount: 4,
      unitPricePerCore: '1500000.00',
    });
    expect(PriceSchema.parse(view)).toStrictEqual(view);
    expect(PriceSchema.parse(priceView(N_PRICE))).toStrictEqual(priceView(N_PRICE));
  });
});

describe('priceSentence — 코어 적용 행만 접미', () => {
  it('N 행 문장은 그대로', () => {
    expect(priceSentence(N_PRICE)).toBe(
      '2026년 기준 WAPPLES Wapples-500의 가격은 12,000,000원입니다.',
    );
  });

  it('Y + 기준 4 → "(기준 4코어, 추가 1코어당 1,500,000원)"', () => {
    expect(priceSentence(CORE_PRICE)).toBe(
      '2026년 기준 D.AMO D.AMO KE의 가격은 10,000,000원입니다 (기준 4코어, 추가 1코어당 1,500,000원).',
    );
  });

  it('단가유형 표기 뒤에 코어 접미, Y + 기준 0 은 접미 없음', () => {
    expect(priceSentence({ ...CORE_PRICE, priceType: 'ASP', baseCoreCount: 8 })).toBe(
      '2026년 기준 D.AMO D.AMO KE의 가격은 10,000,000원입니다 (ASP) (기준 8코어, 추가 1코어당 1,500,000원).',
    );
    expect(priceSentence(CORE_ZERO)).toBe(
      '2026년 기준 D.AMO D.AMO KE의 가격은 10,000,000원입니다 (조달).',
    );
  });
});

describe('DB 경로 — latestChatPrice·price_lookup·규칙 응답', () => {
  let handle: DbHandle;
  const CODE = 'P10100015';

  beforeAll(async () => {
    handle = await createTestDb();
    const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
    await applyPolicy(
      { handle, actor: TEST_ACTOR, meta: TEST_META },
      { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
    );
  });

  afterAll(async () => {
    await handle.close();
  });

  /** price_lookup 실행 + strict 출력 스키마 통과 확인 */
  async function lookup() {
    const result = await priceLookupTool.run(
      { query: CODE, family: null },
      { db: handle.db, actor: { userId: 'u1', role: 'USER' } },
    );
    expect(priceLookupTool.output.safeParse(result.data).success).toBe(true);
    return result;
  }

  async function setCore(hasCorePrice: boolean, baseCoreCount: number) {
    await handle.db
      .update(salesPrices)
      .set({ hasCorePrice, baseCoreCount, unitPricePerCore: '1500000.00' })
      .where(eq(salesPrices.itemCode, CODE));
  }

  it('N → Y(기준 4) → Y(기준 0): 도구 출력·규칙 응답이 코어 적용 행에서만 바뀐다', async () => {
    await setCore(false, 0);
    const before = await latestChatPrice(handle.db, CODE);
    expect(before).toMatchObject({ hasCorePrice: false, baseCoreCount: 0 });
    const toolN = await lookup();
    const replyN = await respondToChat(handle.db, { role: 'USER' as const }, `${CODE} 가격`);
    expect(JSON.stringify(toolN.data)).not.toMatch(/baseCoreCount|unitPricePerCore/);
    expect(replyN.reply).not.toContain('코어');

    await setCore(true, 4);
    const toolY = await lookup();
    expect(toolY.data.items[0]!.price).toMatchObject({
      baseCoreCount: 4,
      unitPricePerCore: '1500000.00',
    });
    const replyY = await respondToChat(handle.db, { role: 'USER' as const }, `${CODE} 가격`);
    expect(replyY.reply).toBe(
      replyN.reply.replace(/\.$/, ' (기준 4코어, 추가 1코어당 1,500,000원).'),
    );

    await setCore(true, 0);
    const toolZero = await lookup();
    expect(toolZero.data).toStrictEqual(toolN.data);
    expect((await respondToChat(handle.db, { role: 'USER' as const }, `${CODE} 가격`)).reply).toBe(
      replyN.reply,
    );
  });
});
