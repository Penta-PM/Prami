// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { costItemLinks, importBatches, items, materialCosts, salesPrices } from '@/db/schema';
import { costAccessForTests } from '@/server/cost/access-token';
import { getCostRatios, roundHalfUp1 } from '@/server/cost/price-ratio';

import { createTestDb } from '../../helpers/pglite';

/**
 * 원가 비중 (스펙 cost-ratio-price-change §2.2·§4): 정상판매 + 매핑(후보 범위 안) 행만, 같은 화폐·시기 포함 원가,
 * 같은 날짜 중복은 source_row 최대, 이전 원가 대체 없음, 사유 3종, half-up 1자리, **원가 금액 미반환**.
 */
let handle: DbHandle;
const read = costAccessForTests({ id: null, email: 'vitest' }, 'read');

type PriceSeed = {
  itemCode: string;
  priceType?: string;
  currency?: string;
  unitPrice: string;
  effectiveFrom: string;
};
let nextSource = 1;
const ids = new Map<string, number>();

async function price(key: string, seed: PriceSeed) {
  const [row] = await handle.db
    .insert(salesPrices)
    .values({
      sourceId: nextSource++,
      productFamily: 'WAPPLES',
      itemCode: seed.itemCode,
      itemName: seed.itemCode,
      unit: 'EA',
      priceType: seed.priceType ?? '정상판매',
      priceCategory: '일반',
      currency: seed.currency ?? 'KRW',
      hasCorePrice: false,
      unitPrice: seed.unitPrice,
      effectiveFrom: seed.effectiveFrom,
      appliesToAllCustomers: true,
      isFinalSource: true,
      baseCoreCount: 0,
      unitPricePerCore: '0.00',
      customerCode: `C${nextSource}`,
      source: 'erp',
    })
    .returning({ id: salesPrices.id });
  ids.set(key, row!.id);
}

async function cost(
  materialCode: string,
  unitCost: string,
  effectiveFrom: string,
  effectiveTo: string | null,
  extra: { currency?: string; sourceRow?: number; priceType?: string; deleted?: boolean } = {},
) {
  await handle.db.insert(materialCosts).values({
    materialCode,
    materialName: materialCode,
    unit: 'EA',
    priceType: extra.priceType ?? '표준구매원가',
    priceCategory: '일반',
    currency: extra.currency ?? 'KRW',
    unitCost,
    effectiveFrom,
    effectiveTo,
    isFinalSource: true,
    appliesToAllCustomers: true,
    source: 'erp',
    sourceRow: extra.sourceRow ?? null,
    deletedAt: extra.deleted ? new Date() : null,
  });
}

beforeAll(async () => {
  handle = await createTestDb();
  const [batch] = await handle.db
    .insert(importBatches)
    .values({ kind: 'item_master', fileName: 'r.xlsx', fileSha256: 'ratio', fileSize: 1 })
    .returning({ id: importBatches.id });
  const item = (itemCode: string, extra: Partial<typeof items.$inferInsert> = {}) => ({
    itemCode,
    itemName: itemCode,
    categoryMajor: 'WAPPLES',
    categoryMid: 'H/W Appliance',
    categoryMinor: 'Wapples',
    itemKind: '본품' as const,
    itemStatus: '사용' as const,
    importBatchId: batch!.id,
    ...extra,
  });
  await handle.db
    .insert(items)
    .values([
      item('P1700'),
      item('PZERO'),
      item('PUSD'),
      item('PNONE'),
      item('PDUP'),
      item('PNIC', { categoryMid: 'Parts', categoryMinor: 'NIC', itemKind: '파츠' }),
    ]);
  await handle.db.insert(costItemLinks).values([
    { itemCode: 'P1700', materialCode: 'W1700' },
    { itemCode: 'PZERO', materialCode: 'W1700' },
    { itemCode: 'PUSD', materialCode: 'WUSD' },
    { itemCode: 'PNONE', materialCode: 'WLATE' },
    { itemCode: 'PDUP', materialCode: 'WDUP' },
    // 후보 범위 밖(파츠) 링크 — 비중 계산에 쓰지 않는다(Plan Q1 A)
    { itemCode: 'PNIC', materialCode: 'W1700' },
  ]);
  // WAPPLES-1700: 2026-01-01~05-01 3,000,000 → 2026-05-01~ 3,150,000 (가격 시작일 05-01 은 둘째 구간)
  await cost('W1700', '3000000.00', '2026-01-01', '2026-05-01');
  await cost('W1700', '3150000.00', '2026-05-01', null);
  // 삭제된 원가·다른 단가유형은 무시
  await cost('W1700', '1.00', '2026-05-01', null, { deleted: true, sourceRow: 999 });
  await cost('W1700', '2.00', '2026-05-01', null, { priceType: '기타원가' });
  // 다른 화폐 원가만 있음
  await cost('WUSD', '2000.00', '2026-01-01', null, { currency: 'USD' });
  // 가격 시작일보다 늦게 시작한 원가만 있음(이전 원가 대체 없음)
  await cost('WLATE', '1000000.00', '2026-07-01', null);
  // 같은 날짜 중복: source_row 최대(20)가 쓰인다
  await cost('WDUP', '1000000.00', '2026-01-01', null, { sourceRow: 10 });
  await cost('WDUP', '2000000.00', '2026-01-01', null, { sourceRow: 20 });

  await price('normal', {
    itemCode: 'P1700',
    unitPrice: '10500000.00',
    effectiveFrom: '2026-05-01',
  });
  await price('early', {
    itemCode: 'P1700',
    unitPrice: '10000000.00',
    effectiveFrom: '2026-02-01',
  });
  await price('upgrade', {
    itemCode: 'P1700',
    priceType: '업그레이드(H/W)',
    unitPrice: '5000000.00',
    effectiveFrom: '2026-05-01',
  });
  await price('zero', { itemCode: 'PZERO', unitPrice: '0.00', effectiveFrom: '2026-05-01' });
  await price('usd', { itemCode: 'PUSD', unitPrice: '9000000.00', effectiveFrom: '2026-05-01' });
  await price('late', { itemCode: 'PNONE', unitPrice: '9000000.00', effectiveFrom: '2026-05-01' });
  await price('dup', { itemCode: 'PDUP', unitPrice: '8000000.00', effectiveFrom: '2026-03-01' });
  await price('nic', { itemCode: 'PNIC', unitPrice: '500000.00', effectiveFrom: '2026-05-01' });
  await price('unmapped', { itemCode: 'PFREE', unitPrice: '1000.00', effectiveFrom: '2026-05-01' });
});

afterAll(async () => {
  await handle.close();
});

const id = (key: string) => ids.get(key)!;

describe('getCostRatios', () => {
  it('스펙 §4 예: 정상판매 10,500,000(2026-05-01~), 그 시점 원가 3,150,000 → 30.0%, 원가 적용일 2026-05-01', async () => {
    const result = await getCostRatios(read, handle.db, [id('normal')]);
    expect(result).toEqual({ [id('normal')]: { costRatio: 30, costFrom: '2026-05-01' } });
  });

  it('가격 시작일이 앞 구간이면 그 구간 원가(3,000,000 / 10,000,000 = 30.0%)', async () => {
    const result = await getCostRatios(read, handle.db, [id('early')]);
    expect(result[id('early')]).toEqual({ costRatio: 30, costFrom: '2026-01-01' });
  });

  it('사유: 판매가 0 / 화폐 불일치 / 그 시기 원가 없음(늦게 시작한 원가로 대체하지 않음)', async () => {
    const result = await getCostRatios(read, handle.db, [id('zero'), id('usd'), id('late')]);
    expect(result).toEqual({
      [id('zero')]: { costRatio: null, reason: 'zero-price' },
      [id('usd')]: { costRatio: null, reason: 'currency' },
      [id('late')]: { costRatio: null, reason: 'no-cost' },
    });
  });

  it('같은 날짜 중복 원가는 source_row 최대 사용(2,000,000 / 8,000,000 = 25.0%)', async () => {
    const result = await getCostRatios(read, handle.db, [id('dup')]);
    expect(result[id('dup')]).toEqual({ costRatio: 25, costFrom: '2026-01-01' });
  });

  it('정상판매가 아닌 행·매핑 없는 행·후보 범위 밖(파츠) 링크 행은 결과에 없다(화면 "—", 툴팁 없음)', async () => {
    const result = await getCostRatios(read, handle.db, [id('upgrade'), id('unmapped'), id('nic')]);
    expect(result).toEqual({});
  });

  it('응답에 원가 금액이 없다(비율·사유·원가 적용일만)', async () => {
    const result = await getCostRatios(read, handle.db, [...ids.values()]);
    const text = JSON.stringify(result);
    for (const amount of ['3150000', '3000000', '2000000', '1000000', '2000']) {
      expect(text).not.toContain(amount);
    }
    for (const entry of Object.values(result)) {
      expect(Object.keys(entry).sort()).toEqual(
        'costRatio' in entry && entry.costRatio !== null
          ? ['costFrom', 'costRatio']
          : ['costRatio', 'reason'],
      );
    }
  });

  it('빈 목록·잘못된 id 는 조회 없이 {}, 토큰 없이는 실패', async () => {
    expect(await getCostRatios(read, handle.db, [])).toEqual({});
    expect(await getCostRatios(read, handle.db, [-1, 0, 1.5, Number.NaN])).toEqual({});
    await expect(
      getCostRatios(undefined as unknown as typeof read, handle.db, [id('normal')]),
    ).rejects.toThrow(/원가 접근 토큰/);
  });
});

describe('roundHalfUp1', () => {
  it.each([
    [12.25, 12.3],
    [12.24, 12.2],
    [30, 30],
    [0.05, 0.1],
    [33.333, 33.3],
    [99.95, 100],
  ])('%s → %s', (value, expected) => {
    expect(roundHalfUp1(value)).toBe(expected);
  });
});
