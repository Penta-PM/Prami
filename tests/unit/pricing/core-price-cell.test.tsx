import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PriceRowView } from '@/features/pricing/types';

/** 가격 정책 표 판매가 칸 코어 보조 줄 (D.AMO 코어 단가 스펙 §4·§6) — 조회·관리 표 공용 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/pricing',
}));

const { PriceTable } = await import('@/features/pricing/PriceTable');

const BASE: PriceRowView = {
  id: 1,
  priceType: '정상판매',
  major: 'D.AMO',
  mid: null,
  minor: null,
  itemCode: 'P20100001',
  itemName: 'D.AMO KE',
  unitPrice: '10000000.00',
  currency: 'KRW',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  itemStatus: '사용',
  operationStatus: '운영중',
  remark: null,
  source: 'erp',
  hasCorePrice: false,
  baseCoreCount: 0,
  unitPricePerCore: '0.00',
};

/** Y + 기준 4 = 코어 적용 */
const CORE: PriceRowView = {
  ...BASE,
  id: 2,
  itemCode: 'P20100002',
  hasCorePrice: true,
  baseCoreCount: 4,
  unitPricePerCore: '1500000.00',
};
/** Y + 기준 0 (조달, D4) = 코어 미적용 */
const CORE_ZERO: PriceRowView = {
  ...BASE,
  id: 3,
  itemCode: 'P20100003',
  priceType: '조달',
  hasCorePrice: true,
  baseCoreCount: 0,
  unitPricePerCore: '1500000.00',
};
/** N 인데 기준·1코어 단가 값이 남아 있는 행 = 코어 미적용 */
const N_WITH_VALUES: PriceRowView = {
  ...BASE,
  id: 4,
  itemCode: 'P20100004',
  baseCoreCount: 4,
  unitPricePerCore: '1500000.00',
};
/** 키 없는 행(이전 모양) = 코어 미적용 */
const NO_KEYS: PriceRowView = { ...BASE, id: 5, itemCode: 'P20100005' };
delete NO_KEYS.hasCorePrice;
delete NO_KEYS.baseCoreCount;
delete NO_KEYS.unitPricePerCore;

function priceCell(rowId: number): HTMLElement {
  const row = screen.getByText(`P2010000${rowId}`).closest('tr')!;
  const index = [...document.querySelectorAll('thead th')].findIndex(
    (th) => th.textContent === '판매가',
  );
  return row.querySelectorAll('td')[index] as HTMLElement;
}

describe('가격 정책 표 판매가 칸 — 코어 보조 줄', () => {
  it.each(['view', 'admin'] as const)(
    '%s 표: Y + 기준 1 이상 행만 "기준 N코어 · +1코어 금액", 열 추가 없음',
    (mode) => {
      render(
        <PriceTable
          mode={mode}
          rows={[BASE, CORE, CORE_ZERO, N_WITH_VALUES, NO_KEYS]}
          userId="u1"
          onRowClick={vi.fn()}
        />,
      );
      const aux = document.querySelectorAll('[data-core-price]');
      expect(aux).toHaveLength(1);
      expect(aux[0]).toHaveTextContent('기준 4코어 · +1코어 1,500,000원');
      expect(aux[0]).toHaveClass('text-[11px]', 'text-text-tertiary');

      expect(priceCell(2)).toHaveTextContent('10,000,000원기준 4코어 · +1코어 1,500,000원');
      // N 행·Y+기준 0 행·키 없는 행은 판매가만 (기존과 같음)
      for (const id of [1, 3, 4, 5]) {
        expect(priceCell(id).textContent).toBe('10,000,000원');
        expect(priceCell(id).querySelector('[data-core-price]')).toBeNull();
      }
      // 열 머리글에 코어 열이 없다
      const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent);
      expect(headers.some((text) => text?.includes('코어'))).toBe(false);
    },
  );

  it('외화 행은 같은 통화 표기를 쓴다', () => {
    render(
      <PriceTable
        mode="view"
        rows={[{ ...CORE, currency: 'USD', unitPrice: '1000.00', unitPricePerCore: '250.00' }]}
        userId="u1"
        onRowClick={vi.fn()}
      />,
    );
    expect(document.querySelector('[data-core-price]')).toHaveTextContent(
      '기준 4코어 · +1코어 250 USD',
    );
  });
});
