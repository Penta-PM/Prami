// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { costFilterToQuery } from '@/features/costs/query';
import {
  deriveMaterialFamily,
  MATERIAL_FAMILIES,
  MATERIAL_FAMILY_OTHER,
} from '@/lib/constants/material-family';
import { hasFinalConsonant, withParticle } from '@/lib/korean';
import { computeNetSales } from '@/lib/pricing/margin';
import { parseCostFilter } from '@/server/cost/filter';
import { costSeriesKey } from '@/server/cost/series';

describe('한국어 조사 (PR-4 QA INFO "사유을(를)" 수정)', () => {
  it('받침 유무로 을/를·이/가·은/는 을 고른다', () => {
    expect(withParticle('사유', '을/를')).toBe('사유를');
    expect(withParticle('변경 사유', '을/를')).toBe('변경 사유를');
    expect(withParticle('품번', '을/를')).toBe('품번을');
    expect(withParticle('단가', '이/가')).toBe('단가가');
    expect(withParticle('적용시작일', '은/는')).toBe('적용시작일은');
    expect(withParticle('id', '을/를')).toBe('id를');
    expect(hasFinalConsonant('')).toBe(false);
  });
});

describe('원가 제품군 파생 (Q-03 가정 채택)', () => {
  it('W1=WAPPLES, W2=D.AMO, W4=iSIGN, 그 외 기타', () => {
    expect(deriveMaterialFamily('W10100016')).toBe('WAPPLES');
    expect(deriveMaterialFamily('w20100001')).toBe('D.AMO');
    expect(deriveMaterialFamily('W40100002')).toBe('iSIGN');
    expect(deriveMaterialFamily('W30100001')).toBe(MATERIAL_FAMILY_OTHER);
    expect(deriveMaterialFamily('W8')).toBe(MATERIAL_FAMILY_OTHER);
    expect(MATERIAL_FAMILIES).toEqual(['WAPPLES', 'D.AMO', 'iSIGN', '기타']);
  });

  it('원가 계열 키 = 자재번호|단가유형|단가구분|화폐', () => {
    expect(
      costSeriesKey({
        materialCode: 'W1',
        priceType: '표준구매원가',
        priceCategory: '일반',
        currency: 'KRW',
      }),
    ).toBe('W1|표준구매원가|일반|KRW');
  });
});

describe('원가 필터 URL 상태 (§4.5.5, 요구 14 날짜 두 모드)', () => {
  it('제품군·날짜 모드·기간·검색·페이지 왕복, 잘못된 값 정규화', () => {
    const { filter, errors } = parseCostFilter({
      family: 'WAPPLES',
      dateMode: 'period',
      from: '2024-01-01',
      to: '2024-12-31',
      q: 'NIC',
      page: '2',
    });
    expect(filter).toEqual({
      family: 'WAPPLES',
      dateMode: 'period',
      from: '2024-01-01',
      to: '2024-12-31',
      q: 'NIC',
      page: 2,
    });
    expect(errors).toEqual({});
    expect(costFilterToQuery(filter)).toBe(
      '?family=WAPPLES&dateMode=period&from=2024-01-01&to=2024-12-31&q=NIC&page=2',
    );
    expect(parseCostFilter({ family: '전체', dateMode: 'bogus', page: 'x' }).filter).toEqual({
      dateMode: 'start',
      page: 1,
    });
    const swapped = parseCostFilter({ from: '2025-01-01', to: '2024-01-01' });
    expect(swapped.errors.to).toContain('종료일');
    expect(swapped.filter.from).toBeUndefined();
    expect(costFilterToQuery({ dateMode: 'start', page: 1 })).toBe('');
  });
});

describe('순매출 계산 순수 함수 (§4.5.5)', () => {
  it('원가 없음 → 매출·할인·순매출만, 원가 있음 → 원가·이익·이익률', () => {
    const locked = computeNetSales({ sellingPrice: 1000, quantity: 3, discountRate: 10 });
    expect(locked).toEqual({
      grossAmount: '3000.00',
      discountAmount: '300.00',
      netAmount: '2700.00',
      miscAmount: '0.00',
    });
    expect('cost' in locked).toBe(false);
    const open = computeNetSales({
      sellingPrice: 1000,
      quantity: 3,
      discountRate: 10,
      unitCost: 600,
    });
    expect(open.cost).toEqual({ totalCost: '1800.00', profit: '900.00', marginRate: '33.3' });
    // §4.5.7: net = actual − cost − misc, rate = net/actual
    const withMisc = computeNetSales({
      sellingPrice: 1000,
      quantity: 3,
      discountRate: 10,
      unitCost: 600,
      miscCost: 200,
    });
    expect(withMisc.miscAmount).toBe('200.00');
    expect(withMisc.cost).toEqual({ totalCost: '1800.00', profit: '700.00', marginRate: '25.9' });
    expect(computeNetSales({ sellingPrice: 0, quantity: 1, unitCost: 5 }).cost?.marginRate).toBe(
      '0.0',
    );
    expect(computeNetSales({ sellingPrice: 100, quantity: 1, discountRate: 150 }).netAmount).toBe(
      '0.00',
    );
  });
});
