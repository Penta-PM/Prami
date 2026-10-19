import { describe, expect, it } from 'vitest';

import { CHAT_MAX_LENGTH, classifyIntent, normalizeMessage } from '@/server/chat/intent';

/** 의도 분류 (§4.5.9): 원가 → 연도 비교 → 견적 → 가격 → 도움말, 검색어·제품군 추출, 별칭(SA-500 → Wapples-500/H500) */
describe('classifyIntent', () => {
  it('가격 조회: 품명·품번 검색어를 추출하고 조사·서술어를 걷어낸다', () => {
    expect(classifyIntent('Wapples-500 가격 알려줘')).toMatchObject({
      kind: 'price',
      query: 'Wapples-500',
      family: null,
    });
    expect(classifyIntent('WAPPLES Wapples-500의 가격이 얼마야?')).toMatchObject({
      kind: 'price',
      query: 'Wapples-500',
      family: 'WAPPLES',
    });
    expect(classifyIntent('P10100015 단가')).toMatchObject({ kind: 'price', query: 'P10100015' });
    // 모델만 보내도(후보 칩 클릭) 가격 조회
    expect(classifyIntent('P10100015')).toMatchObject({ kind: 'price', query: 'P10100015' });
    expect(classifyIntent('가격 알려줘')).toMatchObject({ kind: 'price', query: null });
  });

  it('별칭: SA-500 → Wapples-500, H500 검색어로 넓힌다 (디자인 예시)', () => {
    const intent = classifyIntent('SA-500 가격이 얼마야?');
    expect(intent.kind).toBe('price');
    expect(intent.terms).toEqual(['SA-500', 'Wapples-500', 'H500']);
    expect(classifyIntent('H500 가격').terms).toEqual(['H500', 'Wapples-500']);
  });

  it('연도 비교: 작년/전년/올랐/내렸', () => {
    expect(classifyIntent('작년보다 올랐어?')).toMatchObject({ kind: 'compare', query: null });
    expect(classifyIntent('Wapples-500 작년보다 올랐어?')).toMatchObject({
      kind: 'compare',
      query: 'Wapples-500',
    });
    expect(classifyIntent('D.AMO KE 전년 대비 가격 변경')).toMatchObject({
      kind: 'compare',
      family: 'D.AMO',
    });
  });

  it('견적 시작: 제품군만 있으면 family, 품명이 있으면 query', () => {
    expect(classifyIntent('견적 뽑아줘')).toMatchObject({
      kind: 'quote',
      query: null,
      family: null,
    });
    expect(classifyIntent('WAPPLES 견적')).toMatchObject({
      kind: 'quote',
      query: null,
      family: 'WAPPLES',
    });
    expect(classifyIntent('Wapples-2700 견적 시작해줘')).toMatchObject({
      kind: 'quote',
      query: 'Wapples-2700',
    });
  });

  it('원가는 다른 의도보다 먼저 잡힌다 (AC-81) — 가격·견적 단어가 같이 있어도', () => {
    expect(classifyIntent('Wapples-500 원가 알려줘').kind).toBe('cost');
    expect(classifyIntent('견적 원가 마진이 얼마야').kind).toBe('cost');
    // 원가 비중 열(cost-ratio-price-change §4 챗봇 회귀): 비중 질의도 원가 의도로 거부 — 비율·원가 수치를 내지 않는다
    expect(classifyIntent('WAPPLES-1700 원가 비중').kind).toBe('cost');
    expect(classifyIntent('WAPPLES-1700 원가 비중 몇 퍼센트야?').kind).toBe('cost');
    expect(classifyIntent('이익률 좀').kind).toBe('cost');
  });

  it('매칭 실패는 help (AC-82)', () => {
    expect(classifyIntent('안녕').kind).toBe('help');
    expect(classifyIntent('오늘 날씨 어때').kind).toBe('help');
    expect(classifyIntent('').kind).toBe('help');
  });

  it('normalizeMessage: 공백 정리·제어 문자 제거·길이 제한 (검색과 같은 규칙)', () => {
    expect(normalizeMessage('  Wapples-500 \u0000 가격\n\n알려줘  ')).toBe(
      'Wapples-500 가격 알려줘',
    );
    expect(normalizeMessage('a'.repeat(1000))).toHaveLength(CHAT_MAX_LENGTH);
    // SQL/HTML 문자는 그대로 두되(ILIKE 는 파라미터 바인딩) 길이만 제한
    expect(normalizeMessage("'; drop table sales_prices; --")).toBe(
      "'; drop table sales_prices; --",
    );
  });
});
