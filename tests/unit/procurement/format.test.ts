import { describe, expect, it } from 'vitest';

import { isOurManufacturer as isOurFromConstants } from '@/lib/procurement/constants';
import {
  OUR_COMPANY_NAMES,
  isOurManufacturer,
  ourTargetShare,
  normalizeCompanyName,
} from '@/lib/procurement/our-company';
import {
  formatChangeRate,
  formatCount,
  formatEokMan,
  formatMillionWon,
  formatShare,
  millionWonHeader,
} from '@/lib/procurement/format';

/** 조달 금액 표기 D-3: 표 = 백만원 소수 1자리(단위는 머리글), KPI·툴팁 = 억·만 */
describe('formatMillionWon (표)', () => {
  it('원 → 백만원 소수 1자리, 천 단위 구분', () => {
    expect(formatMillionWon(123_456_789)).toBe('123.5');
    expect(formatMillionWon(1_234_500_000)).toBe('1,234.5');
    expect(formatMillionWon(100_000_000)).toBe('100.0');
    expect(formatMillionWon(40_000)).toBe('0.0');
    expect(formatMillionWon(0)).toBe('0.0');
    expect(formatMillionWon(-40_000)).toBe('0.0');
    expect(formatMillionWon(-2_550_000)).toBe('-2.5');
  });

  it('값 없음 = —', () => {
    expect(formatMillionWon(null)).toBe('—');
    expect(formatMillionWon(undefined)).toBe('—');
    expect(formatMillionWon(Number.NaN)).toBe('—');
  });

  it('단위 머리글', () => {
    expect(millionWonHeader('납품금액')).toBe('납품금액 (백만원)');
  });
});

describe('formatEokMan (KPI·툴팁)', () => {
  it('억·만 (만 미만 반올림)', () => {
    expect(formatEokMan(1_234_000_000)).toBe('12억 3,400만');
    expect(formatEokMan(1_234_005_000)).toBe('12억 3,401만');
    expect(formatEokMan(100_000_000)).toBe('1억');
    expect(formatEokMan(34_000_000)).toBe('3,400만');
    expect(formatEokMan(12_345_678_900_000)).toBe('123,456억 7,890만');
    expect(formatEokMan(10_000)).toBe('1만');
  });

  it('반올림 올림이 억으로 넘어간다', () => {
    expect(formatEokMan(99_999_999)).toBe('1억');
  });

  it('1만 미만은 원, 0 은 0원, 음수는 -', () => {
    expect(formatEokMan(5_000)).toBe('5,000원');
    expect(formatEokMan(0)).toBe('0원');
    expect(formatEokMan(-1_234_000_000)).toBe('-12억 3,400만');
    expect(formatEokMan(-500)).toBe('-500원');
    expect(formatEokMan(null)).toBe('—');
  });
});

describe('비율·건수', () => {
  it('점유율·증감률', () => {
    expect(formatShare(0.6)).toBe('60.0%');
    expect(formatShare(0.12345)).toBe('12.3%');
    expect(formatShare(null)).toBe('—');
    expect(formatChangeRate(0.123)).toBe('+12.3%');
    expect(formatChangeRate(-0.05)).toBe('-5.0%');
    expect(formatChangeRate(0.00001)).toBe('0.0%');
    expect(formatChangeRate(5)).toBe('+500.0%');
    expect(formatChangeRate(null)).toBe('—');
    expect(formatCount(1234)).toBe('1,234건');
    expect(formatCount(undefined)).toBe('—');
  });
});

/** 자사 판정 (Plan msg_a06f54d8bd3e): 설정 목록 + 공백 제거 + 라틴 대소문자 무시 + 포함 */
const OUR_NAME_CASES: [string | null | undefined, boolean][] = [
  ['(주)펜타시큐리티', true],
  ['펜타 시큐리티', true],
  [' ㈜ 펜 타 시 큐 리 티 ', true],
  ['PENTASECURITY', true],
  ['pentasecurity inc.', true],
  ['Penta Security Inc.', true],
  ['PeNtA sEcUrItY', true],
  ['펜타시큐', false],
  ['펜타보안', false],
  ['Penta Securities', false],
  ['PentaSec', false],
  ['가상보안', false],
  ['', false],
  ['   ', false],
  [null, false],
  [undefined, false],
];

describe('our-company', () => {
  it('목록·정규화', () => {
    expect(OUR_COMPANY_NAMES).toContain('펜타시큐리티');
    expect(normalizeCompanyName(' Penta Security ')).toBe('pentasecurity');
    expect(normalizeCompanyName('펜 타')).toBe('펜타');
  });

  it.each(OUR_NAME_CASES)('isOurManufacturer(%j) = %s', (name, expected) => {
    expect(isOurManufacturer(name)).toBe(expected);
    // constants.ts 재노출도 같은 함수
    expect(isOurFromConstants(name)).toBe(expected);
  });
});

describe('ourTargetShare (월 실적 보고표 목표 점유율 — 원본 값 그대로)', () => {
  it('D.AMO 2026 = 43%, 그 밖의 제품·연도는 없음(화면 "—")', () => {
    expect(ourTargetShare('D.AMO', 2026)).toBe(0.43);
    expect(ourTargetShare('D.AMO', 2025)).toBeNull();
    expect(ourTargetShare('WAPPLES', 2026)).toBeNull();
    expect(ourTargetShare('iSIGN', 2026)).toBeNull();
    expect(ourTargetShare('ALL', 2026)).toBeNull();
  });
});
