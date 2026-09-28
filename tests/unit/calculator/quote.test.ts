import { describe, expect, it } from 'vitest';

import {
  cartTotals,
  clampRate,
  computeLine,
  floorToThousand,
  groupSubtotal,
  rateFromTarget,
  roundRate,
  settleAmount,
  unitWithOptions,
} from '@/lib/pricing/quote';

/** AC-60 — quote.ts 순수 함수 경계값 (스펙 케이스 그대로) */
const PART = { itemCode: 'P', itemName: 'part', unitPrice: 500_000 };

describe('computeLine', () => {
  it('(20,000,000 + 500,000) × 2, 할인 12.5% → 35,875,000', () => {
    const line = computeLine({ basePrice: 20_000_000, parts: [PART], qty: 2, discountRate: 12.5 });
    expect(line).toEqual({
      preDiscount: 41_000_000,
      discountAmount: 5_125_000,
      lineTotal: 35_875_000,
    });
  });

  it('1,000원 절삭: 12,345,678 → 12,345,000', () => {
    expect(floorToThousand(12_345_678)).toBe(12_345_000);
    expect(computeLine({ basePrice: 12_345_678, qty: 1, discountRate: 0 }).lineTotal).toBe(
      12_345_000,
    );
    expect(floorToThousand(999)).toBe(0);
    expect(floorToThousand(-1)).toBe(0);
  });

  it('1,000원 절삭은 KRW 에만 — USD/JPY 는 소수 2자리 반올림', () => {
    expect(computeLine({ basePrice: 10, qty: 1, discountRate: 0, currency: 'USD' }).lineTotal).toBe(
      10,
    );
    expect(
      computeLine({ basePrice: 10, qty: 3, discountRate: 12.5, currency: 'USD' }).lineTotal,
    ).toBe(26.25);
    expect(
      computeLine({ basePrice: 999, qty: 1, discountRate: 0, currency: 'JPY' }).lineTotal,
    ).toBe(999);
    expect(
      computeLine({ basePrice: 999, qty: 1, discountRate: 0, currency: 'KRW' }).lineTotal,
    ).toBe(0);
    expect(settleAmount(1234.567, 'USD')).toBe(1234.57);
    expect(settleAmount(-5, 'USD')).toBe(0);
  });

  it('경계: 0% → 절삭만, 100% → 0, 수량 0 → 0, 결합형도 합산', () => {
    expect(computeLine({ basePrice: 41_000_000, qty: 1, discountRate: 0 }).lineTotal).toBe(
      41_000_000,
    );
    expect(computeLine({ basePrice: 41_000_000, qty: 1, discountRate: 100 }).lineTotal).toBe(0);
    expect(computeLine({ basePrice: 41_000_000, qty: 0, discountRate: 0 }).lineTotal).toBe(0);
    expect(
      unitWithOptions({ basePrice: 100, parts: [PART], bundles: [{ ...PART, unitPrice: 50 }] }),
    ).toBe(500_150);
    expect(computeLine({ basePrice: 10_000, qty: 3, discountRate: 150 }).lineTotal).toBe(0);
    expect(computeLine({ basePrice: 10_000, qty: 3, discountRate: -5 }).lineTotal).toBe(30_000);
  });
});

describe('rateFromTarget (목표금액 역산)', () => {
  it('target=30,000,000, pre=41,000,000 → 26.8%', () => {
    expect(rateFromTarget(30_000_000, 41_000_000)).toBe(26.8);
  });

  it('경계: target=pre → 0, target=0 → 100, target > pre → 0, pre=0 → 0, 음수·NaN → 0', () => {
    expect(rateFromTarget(41_000_000, 41_000_000)).toBe(0);
    expect(rateFromTarget(0, 41_000_000)).toBe(100);
    expect(rateFromTarget(50_000_000, 41_000_000)).toBe(0);
    expect(rateFromTarget(1, 0)).toBe(0);
    expect(rateFromTarget(-5, 41_000_000)).toBe(100);
    expect(rateFromTarget(Number.NaN, 41_000_000)).toBe(0);
  });

  it('역산 → 재계산하면 목표 이하로 1,000원 절삭된 금액이 나온다', () => {
    const rate = rateFromTarget(30_000_000, 41_000_000);
    const line = computeLine({ basePrice: 41_000_000, qty: 1, discountRate: rate });
    expect(line.lineTotal).toBeLessThanOrEqual(30_100_000);
    expect(line.lineTotal % 1000).toBe(0);
  });

  it('clampRate / roundRate', () => {
    expect(clampRate(120)).toBe(100);
    expect(clampRate(-1)).toBe(0);
    expect(clampRate(Number.POSITIVE_INFINITY)).toBe(0);
    expect(roundRate(26.84)).toBe(26.8);
    expect(roundRate(26.85)).toBe(26.9);
  });
});

describe('cartTotals (AC-65 통화 혼합)', () => {
  it('단일 통화면 합계, 통화가 섞이면 통화별 소계만', () => {
    expect(
      cartTotals([
        { currency: 'KRW', lineTotal: 1_000 },
        { currency: 'KRW', lineTotal: 2_000 },
      ]),
    ).toEqual({
      subtotals: [{ currency: 'KRW', amount: 3_000 }],
      total: 3_000,
      currency: 'KRW',
      count: 2,
    });
    expect(
      cartTotals([
        { currency: 'USD', lineTotal: 10 },
        { currency: 'KRW', lineTotal: 2_000 },
      ]),
    ).toEqual({
      subtotals: [
        { currency: 'KRW', amount: 2_000 },
        { currency: 'USD', amount: 10 },
      ],
      total: null,
      currency: null,
      count: 2,
    });
    expect(cartTotals([])).toEqual({ subtotals: [], total: null, currency: null, count: 0 });
  });
});

describe('groupSubtotal', () => {
  it('하드웨어 + 체크된 항목 × 수량', () => {
    expect(
      groupSubtotal(1_000_000, [
        { unitPrice: 100, qty: 2, checked: true },
        { unitPrice: 50, qty: 1, checked: false },
        { unitPrice: 30, qty: 0, checked: true },
      ]),
    ).toBe(1_000_230);
  });
});
