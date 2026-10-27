import { describe, expect, it } from 'vitest';

import {
  BID_KEYWORD_GROUP_KEYS,
  BID_KEYWORD_MAX_LENGTH,
  bidKeywordKey,
  checkBidKeyword,
  isBidKeywordGroup,
  normalizeBidKeyword,
} from '@/lib/procurement/keywords';

/** 조달이 통합 UI-8 — 키워드 입력 규칙 (화면·서버 공용, 합성 값만) */
describe('키워드 그룹', () => {
  it('제품 3개 + 제외 (DB CHECK 와 같은 값·순서)', () => {
    expect(BID_KEYWORD_GROUP_KEYS).toEqual(['WAPPLES', 'D.AMO', 'iSIGN', '제외']);
    expect(isBidKeywordGroup('제외')).toBe(true);
    expect(isBidKeywordGroup('기타')).toBe(false);
    expect(isBidKeywordGroup(undefined)).toBe(false);
  });
});

describe('normalizeBidKeyword', () => {
  it('앞뒤 공백 제거·연속 공백 1칸', () => {
    expect(normalizeBidKeyword('  가상   방화벽  ')).toEqual({ ok: true, keyword: '가상 방화벽' });
  });

  it('빈 값·공백만·문자열 아님 거부', () => {
    for (const raw of ['', '   ', null, 3]) {
      expect(normalizeBidKeyword(raw)).toEqual({ ok: false, message: '키워드를 입력하세요' });
    }
  });

  it(`길이 ${BID_KEYWORD_MAX_LENGTH}자(코드 포인트) 까지`, () => {
    expect(normalizeBidKeyword('가'.repeat(BID_KEYWORD_MAX_LENGTH)).ok).toBe(true);
    expect(normalizeBidKeyword('가'.repeat(BID_KEYWORD_MAX_LENGTH + 1))).toEqual({
      ok: false,
      message: `키워드는 ${BID_KEYWORD_MAX_LENGTH}자 이하로 입력하세요`,
    });
  });

  it('제어 문자·보이지 않는 문자 거부 (탭·줄바꿈·NUL·폭 없는 공백·BOM·방향 제어)', () => {
    for (const raw of [
      '가상\t방화벽',
      '가상\n',
      'a\u0000b',
      '가\u200b상',
      '\ufeff가상',
      '가\u202e상',
    ]) {
      expect(normalizeBidKeyword(raw)).toEqual({
        ok: false,
        message: '제어 문자나 보이지 않는 문자는 넣을 수 없습니다',
      });
    }
  });
});

describe('checkBidKeyword (그룹 안 중복)', () => {
  it('정규화한 값이 이미 있으면 거부, 없으면 통과', () => {
    expect(checkBidKeyword(' 가상  키워드 ', ['가상 키워드'])).toEqual({
      ok: false,
      message: '이미 있는 키워드입니다: 가상 키워드',
    });
    expect(checkBidKeyword('가상키워드', ['가상 키워드'])).toEqual({
      ok: true,
      keyword: '가상키워드',
    });
  });

  it('형식 오류가 중복보다 먼저', () => {
    expect(checkBidKeyword('', [''])).toEqual({ ok: false, message: '키워드를 입력하세요' });
  });

  it("라틴 문자는 대소문자 무시: 'WAF' 가 있으면 'waf'·'Waf' 거부 (안내는 기존 표기)", () => {
    expect(checkBidKeyword('waf', ['WAF'])).toEqual({
      ok: false,
      message: '이미 있는 키워드입니다: WAF',
    });
    expect(checkBidKeyword(' Web  Firewall ', ['web firewall']).ok).toBe(false);
  });

  it('같은 단어라도 다른 그룹 목록에는 없으므로 통과 (그룹별 목록으로 검사)', () => {
    expect(checkBidKeyword('waf', [])).toEqual({ ok: true, keyword: 'waf' });
  });

  it('한글·라틴 외 문자는 영향 없음 (비교 키는 A–Z 만 소문자)', () => {
    expect(bidKeywordKey('가상 WAF Ä')).toBe('가상 waf Ä');
    expect(checkBidKeyword('가상방화벽', ['가상 방화벽']).ok).toBe(true);
    expect(checkBidKeyword('가상 방화벽', ['가상 방화벽']).ok).toBe(false);
  });
});
