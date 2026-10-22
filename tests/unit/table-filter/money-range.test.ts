import { describe, expect, it } from 'vitest';

import {
  isOutsideRange,
  MONEY_SLIDER_STEPS,
  moneyCompact,
  moneyFull,
  moneyRangesOf,
  moneyRangeText,
  moneyScaleState,
  roundSignificant,
  stepToValue,
  stepValue,
  toMoneyRange,
  valueToStep,
  type MoneyRange,
} from '@/lib/table/money-range';

/**
 * 판매가·원가 슬라이더 로그 눈금 (빠른 필터 바 §7.5): 칸 0 = 하한 없음(0원 포함), 칸 1..200 = [0 초과 최소, 최대] 로그,
 * 유효숫자 2자리(하한 내림·상한 올림), 양 끝은 실제 값, 양 끝 = 조건 없음, 옛 URL 값 → 가까운 칸, compact 표기.
 */

/** 실데이터 모양 — KRW 판매가 0원 포함, 0 초과 최소 500원 ~ 최대 16.5억 */
const KRW: MoneyRange = { currency: 'KRW', min: 0, max: 1_650_000_000, minPositive: 500 };

describe('roundSignificant — 유효숫자 2자리', () => {
  it('하한은 내림, 상한은 올림', () => {
    expect(roundSignificant(1_349_999, 'down')).toBe('1300000');
    expect(roundSignificant(1_349_999, 'up')).toBe('1400000');
    expect(roundSignificant(9_750_000, 'down')).toBe('9700000');
    expect(roundSignificant(9_750_000, 'up')).toBe('9800000');
  });

  it('이미 2자리면 그대로 (부동소수 오차로 한 칸 어긋나지 않음)', () => {
    expect(roundSignificant(1300, 'down')).toBe('1300');
    expect(roundSignificant(1300, 'up')).toBe('1300');
    expect(roundSignificant(0.29, 'down')).toBe('0.29');
    expect(roundSignificant(0.29, 'up')).toBe('0.29');
  });

  it('작은 값·소수 — 지수 표기 없는 10진 문자열', () => {
    expect(roundSignificant(7.777, 'down')).toBe('7.7');
    expect(roundSignificant(7.777, 'up')).toBe('7.8');
    expect(roundSignificant(0.0123, 'up')).toBe('0.013');
    expect(roundSignificant(123_456_789_012, 'up')).toBe('130000000000');
  });
});

describe('칸 ↔ 금액', () => {
  it('칸 0: 하한 = 조건 없음(0원 포함), 상한 = 실제 최소', () => {
    expect(stepToValue(0, 'lower', KRW)).toBeNull();
    expect(stepToValue(0, 'upper', KRW)).toBe('0');
  });

  it('칸 200: 상한 = 조건 없음, 하한 = 실제 최대', () => {
    expect(stepToValue(MONEY_SLIDER_STEPS, 'upper', KRW)).toBeNull();
    expect(stepToValue(MONEY_SLIDER_STEPS, 'lower', KRW)).toBe('1650000000');
  });

  it('칸 1 = 0 초과 실제 최소, 칸 200 = 실제 최대 (반올림하지 않음)', () => {
    const odd: MoneyRange = { currency: 'USD', min: 12.34, max: 98_765.43, minPositive: 12.34 };
    expect(stepValue(1, 'lower', odd)).toBe('12.34');
    expect(stepValue(1, 'upper', odd)).toBe('12.34');
    expect(stepValue(MONEY_SLIDER_STEPS, 'lower', odd)).toBe('98765.43');
    expect(stepValue(0, 'lower', odd)).toBe('12.34');
  });

  it('사이 칸은 로그 + 유효숫자 2자리 — 하한 ≤ 상한, 단조 증가', () => {
    let prev = 0;
    for (let step = 1; step <= MONEY_SLIDER_STEPS; step += 1) {
      const lo = Number(stepValue(step, 'lower', KRW));
      const hi = Number(stepValue(step, 'upper', KRW));
      expect(lo).toBeLessThanOrEqual(hi);
      expect(lo).toBeGreaterThanOrEqual(prev);
      prev = lo;
      if (step > 1 && step < MONEY_SLIDER_STEPS) {
        // 유효숫자 2자리
        expect(Number(lo.toPrecision(2))).toBe(lo);
        expect(Number(hi.toPrecision(2))).toBe(hi);
      }
    }
  });

  it('가운데 칸은 기하 평균 근처 (로그 눈금)', () => {
    // 500 × (16.5억/500)^(99.5/199) ≈ 90.8만
    const middle = Number(stepValue(100, 'lower', KRW));
    expect(middle).toBeGreaterThan(800_000);
    expect(middle).toBeLessThan(1_000_000);
  });

  it('칸 → 금액 → 칸 왕복 — 반올림 오차 안에서 같은 칸(±1)', () => {
    for (const step of [2, 37, 100, 150, 199]) {
      for (const handle of ['lower', 'upper'] as const) {
        const back = valueToStep(Number(stepValue(step, handle, KRW)), handle, KRW);
        expect(Math.abs(back - step)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('valueToStep — 옛 URL·범위 밖 값의 핸들 위치', () => {
  it('하한 0 이하 → 칸 0, 0 초과 최소 미만 → 칸 1, 최대 이상 → 칸 200', () => {
    expect(valueToStep(0, 'lower', KRW)).toBe(0);
    expect(valueToStep(-10, 'lower', KRW)).toBe(0);
    expect(valueToStep(100, 'lower', KRW)).toBe(1);
    expect(valueToStep(5_000_000_000, 'lower', KRW)).toBe(MONEY_SLIDER_STEPS);
  });

  it('상한: 최소(0) 이하 → 칸 0, 최대 이상 → 칸 200', () => {
    expect(valueToStep(0, 'upper', KRW)).toBe(0);
    expect(valueToStep(9e12, 'upper', KRW)).toBe(MONEY_SLIDER_STEPS);
  });

  it('범위 밖 판정', () => {
    expect(isOutsideRange(5_000_000_000, KRW)).toBe(true);
    expect(isOutsideRange(-1, KRW)).toBe(true);
    expect(isOutsideRange(5000, KRW)).toBe(false);
  });
});

describe('moneyScaleState — 슬라이더 / 문구', () => {
  it('행 없음 → empty, 값 1개뿐 → single, 그 밖 → scale', () => {
    expect(moneyScaleState(undefined)).toEqual({ kind: 'empty' });
    expect(moneyScaleState({ currency: 'USD', min: 126, max: 126, minPositive: 126 })).toEqual({
      kind: 'single',
      value: 126,
    });
    expect(moneyScaleState({ currency: 'USD', min: 0, max: 0, minPositive: null })).toEqual({
      kind: 'single',
      value: 0,
    });
    expect(moneyScaleState(KRW)).toEqual({ kind: 'scale', range: KRW });
  });

  it('0원과 값 하나 → 칸 1..200 은 모두 그 값 (슬라이더는 그린다)', () => {
    const range: MoneyRange = { currency: 'KRW', min: 0, max: 500, minPositive: 500 };
    expect(moneyScaleState(range).kind).toBe('scale');
    expect(stepValue(1, 'lower', range)).toBe('500');
    expect(stepValue(120, 'upper', range)).toBe('500');
    expect(stepToValue(0, 'upper', range)).toBe('0');
  });
});

describe('행 → 통화별 범위 (내 견적 목록)', () => {
  it('통화별 최소·최대·0 초과 최소, 금액 없는 행은 건너뜀, 통화 오름차순', () => {
    expect(
      moneyRangesOf([
        { amount: 3000, currency: 'KRW' },
        null,
        { amount: 0, currency: 'KRW' },
        { amount: 50, currency: 'USD' },
        { amount: 1000, currency: 'KRW' },
        { amount: Number.NaN, currency: 'KRW' },
      ]),
    ).toEqual([
      { currency: 'KRW', min: 0, max: 3000, minPositive: 1000 },
      { currency: 'USD', min: 50, max: 50, minPositive: 50 },
    ]);
  });

  it('DB 집계 행(numeric 문자열) → MoneyRange', () => {
    expect(
      toMoneyRange({ currency: 'KRW', min: '0.00', max: '1500.50', minPositive: null }),
    ).toEqual({ currency: 'KRW', min: 0, max: 1500.5, minPositive: null });
  });
});

describe('표기 — 칩 compact, 팝오버·aria 전체 금액', () => {
  it('KRW 는 ₩ + 만·억·조, 1만 미만은 그대로', () => {
    expect(moneyCompact(1_300_000, 'KRW')).toBe('₩130만');
    expect(moneyCompact(1_650_000_000, 'KRW')).toBe('₩16.5억');
    expect(moneyCompact(5000, 'KRW')).toBe('₩5,000');
    expect(moneyCompact('2000000000000', 'KRW')).toBe('₩2조');
  });

  it('그 밖 통화는 K·M·B, 기호 없는 통화는 코드 뒤에', () => {
    expect(moneyCompact(1300, 'USD')).toBe('$1.3K');
    expect(moneyCompact(2_500_000, 'JPY')).toBe('¥2.5M');
    expect(moneyCompact(900, 'CHF')).toBe('900 CHF');
  });

  it('전체 금액', () => {
    expect(moneyFull(1_300_000, 'KRW')).toBe('₩1,300,000');
    expect(moneyFull('126.5', 'USD')).toBe('$126.5');
  });

  it('범위 문구 — 이상·이하·~·제한 없음', () => {
    expect(moneyRangeText('1300000', null, 'KRW', 'compact')).toBe('₩130만 이상');
    expect(moneyRangeText(null, '5000000', 'KRW')).toBe('₩5,000,000 이하');
    expect(moneyRangeText('1300000', '5000000', 'KRW', 'compact')).toBe('₩130만 ~ ₩500만');
    expect(moneyRangeText(null, null, 'KRW')).toBe('제한 없음');
  });
});
