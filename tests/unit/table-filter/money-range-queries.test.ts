// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { materialCosts, salesPrices } from '@/db/schema';
import { costAccessForTests, type CostAccess } from '@/server/cost/access-token';
import { listCostCurrencies, listCostCurrencyRanges } from '@/server/cost/queries';
import { listPriceCurrencies, listPriceCurrencyRanges } from '@/server/pricing/queries';

import { createTestDb } from '../../helpers/pglite';

/**
 * 슬라이더 범위 쿼리 (빠른 필터 바 §7.5): 통화별 표 전체 최소·최대·0 초과 최소 — 삭제 행 제외, 다른 필터와 무관.
 * 가격: listPriceCurrencyRanges(통화 선택지와 같은 스캔), 원가: listCostCurrencyRanges(cost 접근 토큰 필수).
 */
let handle: DbHandle;
const access = costAccessForTests({ id: null, email: 'vitest-range' }, 'read');

const PRICE_BASE = {
  productFamily: 'WAPPLES',
  itemName: 'item',
  unit: 'EA',
  priceType: null,
  priceCategory: '일반',
  hasCorePrice: false,
  remark: null,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  operationStatus: '운영중' as const,
  appliesToAllCustomers: false,
  isFinalSource: true,
  baseCoreCount: 0,
  unitPricePerCore: '0.00',
  customerCode: '0',
  source: 'erp' as const,
};

const COST_BASE = {
  materialName: 'mat',
  unit: 'EA',
  priceCategory: '일반',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  operationStatus: '운영중' as const,
  isFinalSource: false,
  appliesToAllCustomers: false,
  source: 'erp' as const,
  productFamily: 'WAPPLES',
};

beforeAll(async () => {
  handle = await createTestDb();
  const prices: [string, string, boolean][] = [
    ['KRW', '0.00', false],
    ['KRW', '500.00', false],
    ['KRW', '9750000.00', false],
    ['KRW', '1650000000.00', false],
    // 삭제 행은 범위에 들어가지 않는다
    ['KRW', '9999999999.00', true],
    ['KRW', '1.00', true],
    ['USD', '126.50', false],
    ['USD', '126.50', false],
    ['JPY', '0.00', false],
  ];
  await handle.db.insert(salesPrices).values(
    prices.map(([currency, unitPrice, deleted], i) => ({
      ...PRICE_BASE,
      sourceId: 100 + i,
      itemCode: `R${i}`,
      currency,
      unitPrice,
      deletedAt: deleted ? new Date() : null,
    })),
  );
  const costs: [string, string, boolean][] = [
    ['KRW', '1200.00', false],
    ['KRW', '0.00', false],
    ['KRW', '984000.00', false],
    ['KRW', '77777777.00', true],
    ['EUR', '3.25', false],
    ['EUR', '18.00', false],
  ];
  await handle.db.insert(materialCosts).values(
    costs.map(([currency, unitCost, deleted], i) => ({
      ...COST_BASE,
      materialCode: `C${i}`,
      priceType: `pt${i}`,
      currency,
      unitCost,
      deletedAt: deleted ? new Date() : null,
    })),
  );
});

afterAll(async () => {
  await handle.close();
});

describe('listPriceCurrencyRanges — 판매가 범위', () => {
  it('통화 오름차순, 최소·최대·0 초과 최소 (삭제 제외)', async () => {
    expect(await listPriceCurrencyRanges(handle.db)).toEqual([
      { currency: 'JPY', min: 0, max: 0, minPositive: null },
      { currency: 'KRW', min: 0, max: 1_650_000_000, minPositive: 500 },
      { currency: 'USD', min: 126.5, max: 126.5, minPositive: 126.5 },
    ]);
  });

  it('통화 선택지(listPriceCurrencies)는 같은 스캔의 통화 코드', async () => {
    expect(await listPriceCurrencies(handle.db)).toEqual(['JPY', 'KRW', 'USD']);
  });
});

describe('listCostCurrencyRanges — 원가 범위 (cost.read)', () => {
  it('통화 오름차순, 최소·최대·0 초과 최소 (삭제 제외), 통화 선택지와 같은 통화', async () => {
    const ranges = await listCostCurrencyRanges(access, handle.db);
    expect(ranges).toEqual([
      { currency: 'EUR', min: 3.25, max: 18, minPositive: 3.25 },
      { currency: 'KRW', min: 0, max: 984_000, minPositive: 1200 },
    ]);
    expect(ranges.map((range) => range.currency)).toEqual(
      await listCostCurrencies(access, handle.db),
    );
  });

  it('원가 접근 토큰 없이는 부를 수 없다 (assertCostAccess 첫 줄)', async () => {
    await expect(listCostCurrencyRanges(null as unknown as CostAccess, handle.db)).rejects.toThrow(
      /원가 접근 토큰/,
    );
  });

  it('가격 범위에는 원가 값이 섞이지 않는다 (서로 다른 표)', async () => {
    const price = JSON.stringify(await listPriceCurrencyRanges(handle.db));
    expect(price).not.toMatch(/984000|"EUR"|1200/);
  });
});
