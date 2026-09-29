import { describe, expect, it } from 'vitest';

import {
  anchorToken,
  looseTokenMatch,
  matchByTokens,
  modelTokens,
  strictTokenMatch,
  tokenize,
} from '@/server/chat/match';

/**
 * 챗봇 품명 매칭 (§4.5.9 r6, AC-80, PR-10 QA L-1): 토큰 경계 매칭. 후보 이름은 로컬 prami DB(원본 5,885행)의
 * WAPPLES 운영중 품명 중 "500" 이 들어간 것 그대로다 — 부분 문자열이면 모두 걸리지만 규칙상 H500 T2/T3 만 남아야 한다.
 */
const REAL_500 = [
  'SSD 500GB',
  'Wapples SA-500',
  'Wapples SA-5000',
  'Wapples 500 T2 S/W v5.0 업그레이드',
  'Wapples 500 T3 S/W v5.0 업그레이드',
  'Wapples-5000',
  'Wapples-500 (H500 T2)',
  'Wapples-500 (H500 T3)',
  'Wapples-MS-Std-(WAPPLES-500 T2)',
  'Wapples-V500 (월사용료)',
  'Wapples-V500 (일시불)',
  'SSL가속카드 BPC_5000A',
].map((itemName, index) => ({ itemCode: `P${index}`, itemName }));

const names = (query: string) => matchByTokens(REAL_500, query).map((row) => row.itemName);

describe('tokenize / modelTokens', () => {
  it('[공백 - _ / ( )] 로 자르고 소문자, NBSP 는 공백', () => {
    expect(tokenize('Wapples-500 (H500 T2)')).toEqual(['wapples', '500', 'h500', 't2']);
    expect(tokenize('Wapples SA_500/x')).toEqual(['wapples', 'sa', '500', 'x']);
    expect(modelTokens('Wapples-500 (H500 T2)')).toEqual(['wapples-500', 'h500', 't2']);
  });

  it('엄격: 앞 토큰 최대 2개가 품명 앞과 같고 나머지는 어디든; 느슨: 모두 포함', () => {
    expect(strictTokenMatch(['wapples', '500', 'h500', 't2'], ['wapples', '500'])).toBe(true);
    expect(strictTokenMatch(['wapples', '5000'], ['wapples', '500'])).toBe(false);
    expect(
      strictTokenMatch(['wapples', 'ms', 'std', 'wapples', '500', 't2'], ['wapples', '500']),
    ).toBe(false);
    expect(looseTokenMatch(['wapples', '500', 'h500', 't2'], ['h500'])).toBe(true);
    expect(strictTokenMatch([], [])).toBe(false);
  });
});

describe('matchByTokens (실데이터 품명)', () => {
  it('"Wapples-500" → H500 T2·T3 만 (Wapples-5000·MS-Std·S/W 업그레이드·SA-500 제외)', () => {
    expect(names('Wapples-500')).toEqual(['Wapples-500 (H500 T2)', 'Wapples-500 (H500 T3)']);
  });

  it('"Wapples-500 T2" → 유일, 전체 품명 → 유일', () => {
    expect(names('Wapples-500 T2')).toEqual(['Wapples-500 (H500 T2)']);
    expect(names('Wapples-500 (H500 T3)')).toEqual(['Wapples-500 (H500 T3)']);
  });

  it('"Wapples-5000"·"Wapples SA-500" 은 정확히 그 제품', () => {
    expect(names('Wapples-5000')).toEqual(['Wapples-5000']);
    expect(names('Wapples SA-500')).toEqual(['Wapples SA-500']);
  });

  it('모델 번호만("H500")이면 느슨한 규칙으로 H500 계열, 없는 모델은 빈 목록', () => {
    expect(names('H500')).toEqual(['Wapples-500 (H500 T2)', 'Wapples-500 (H500 T3)']);
    expect(names('Wapples-9999')).toEqual([]);
  });

  it('"Wapples" 만이면 앞 토큰이 wapples 인 품명 다수 (4개 이상 → 목록 응답)', () => {
    expect(names('Wapples').length).toBeGreaterThanOrEqual(4);
    expect(names('Wapples')).not.toContain('SSD 500GB');
  });

  it('anchorToken 은 가장 긴 토큰 (SQL 1차 거르기용)', () => {
    expect(anchorToken('Wapples-500 T2')).toBe('wapples');
    expect(anchorToken('  ')).toBeNull();
  });
});
