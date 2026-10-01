import { describe, expect, it } from 'vitest';

import { classifyIntent } from '@/server/chat/intent';

/**
 * PRAMI-003 §4.2.4 · AC-308: ERP 품목대분류 표기(D'Amo, iSIGN+, iSIGN+ PKI)도 제품군으로 인식한다.
 * 기존 PR-10 의도 테스트(intent.test.ts)는 수정하지 않고 이 파일로만 추가한다.
 */
describe('ERP 대분류 표기 별칭 (AC-308)', () => {
  it.each([
    ["D'Amo 견적 시작", 'quote', 'D.AMO'],
    ['D’Amo 가격', 'price', 'D.AMO'],
    ["D'Amo견적", 'quote', 'D.AMO'],
    ['iSIGN+ 가격', 'price', 'iSIGN'],
    ['iSIGN+ PKI 가격 알려줘', 'price', 'iSIGN'],
  ] as const)('%s → %s · %s', (text, kind, family) => {
    expect(classifyIntent(text)).toMatchObject({ kind, family });
  });

  it('별칭은 검색어에 남지 않는다, 기존 표기·모델명은 그대로', () => {
    expect(classifyIntent("D'Amo DA-MYQ 가격").query).toBe('DA-MYQ');
    expect(classifyIntent('D.AMO 가격').family).toBe('D.AMO');
    expect(classifyIntent('Wapples-500 가격')).toMatchObject({
      family: null,
      query: 'Wapples-500',
    });
  });
});
