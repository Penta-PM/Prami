import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CostRatio, costRatioLabel } from '@/features/pricing/cells';
import { columnsFor, layoutColumnsFor } from '@/features/pricing/columns';
import { parsePriceFilter, PRICE_SORT_IDS } from '@/features/pricing/filter';
import { normalizeLayout } from '@/lib/table/layout-storage';

/**
 * 원가 비중 열 (cost-ratio-price-change §2.2-5·§2.3): 관리 표 + cost.read 일 때만, 판매가 바로 뒤, 정렬 불가(sort=costRatio 무시),
 * 칸 표기 NN.N% + 원가 적용일 툴팁, '—' 사유 툴팁 3종, 대상 아닌 행은 툴팁 없는 '—', 저장 레이아웃에 기본 위치로 삽입.
 */
describe('열 정의', () => {
  const keys = (mode: 'view' | 'admin', withCost?: boolean) =>
    columnsFor(mode, withCost).map((column) => column.key);

  it('관리 표 + 원가: 판매가 바로 뒤. 원가 없이는 관리·조회 표 모두 열 없음', () => {
    const admin = keys('admin', true);
    expect(admin[admin.indexOf('price') + 1]).toBe('costRatio');
    expect(keys('admin')).not.toContain('costRatio');
    expect(keys('view')).not.toContain('costRatio');
    expect(keys('view', true)).not.toContain('costRatio');
  });

  it('같은 인자면 같은 배열 참조(레이아웃 정규화 기준)', () => {
    expect(columnsFor('admin', true)).toBe(columnsFor('admin', true));
    expect(layoutColumnsFor('admin', true)).toBe(layoutColumnsFor('admin', true));
  });

  it('정렬 불가: 서버 화이트리스트에 없고 sort=costRatio URL 은 기본 정렬', () => {
    expect(PRICE_SORT_IDS as readonly string[]).not.toContain('costRatio');
    expect(parsePriceFilter({ sort: 'costRatio', dir: 'desc' }).filter.sort).toBeUndefined();
  });

  it('예전 저장 레이아웃(원가 비중 없음) → 판매가 뒤에 끼우고 기존 순서·너비 유지', () => {
    const columns = layoutColumnsFor('admin', true);
    const savedOrder = layoutColumnsFor('admin')
      .filter((column) => !column.pinned)
      .map((column) => column.id)
      .reverse();
    const layout = normalizeLayout({ order: savedOrder, widths: { price: 150 } }, columns)!;
    expect(layout.order.indexOf('costRatio')).toBe(layout.order.indexOf('price') + 1);
    expect(layout.order.filter((id) => id !== 'costRatio' && id !== 'actions')).toEqual(savedOrder);
    expect(layout.widths).toEqual({ price: 150 });
  });
});

describe('CostRatio 칸', () => {
  it('값: NN.N% (소수 1자리 고정) + 툴팁·스크린리더 "원가 적용일 YYYY-MM-DD"', () => {
    const { container } = render(<CostRatio value={{ costRatio: 30, costFrom: '2026-05-01' }} />);
    expect(container).toHaveTextContent('30.0%');
    expect(container.querySelector('[title]')).toHaveAttribute('title', '원가 적용일 2026-05-01');
    expect(screen.getByText(/원가 적용일 2026-05-01/)).toHaveClass('sr-only');
    expect(costRatioLabel(12.3)).toBe('12.3%');
    expect(costRatioLabel(100)).toBe('100.0%');
  });

  it.each([
    ['no-cost', '해당 시기 원가 없음'],
    ['zero-price', '판매가 0'],
    ['currency', '화폐 불일치'],
  ] as const)("사유 %s: '—' + 툴팁 '%s'", (reason, text) => {
    const { container } = render(<CostRatio value={{ costRatio: null, reason }} />);
    expect(container.querySelector('[title]')).toHaveAttribute('title', text);
    expect(screen.getByText(text)).toHaveClass('sr-only');
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
  });

  it("대상 아닌 행(값 없음): 툴팁 없는 '—'", () => {
    const { container } = render(<CostRatio value={undefined} />);
    expect(container).toHaveTextContent('—');
    expect(container.querySelector('[title]')).toBeNull();
  });
});
