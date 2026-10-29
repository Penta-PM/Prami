import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductChip } from '@/components/ui';
import { itemColumns } from '@/features/procurement/items/ItemsBrowser';
import type { ItemRowView } from '@/features/procurement/items/types';
import { ProductCards } from '@/features/home/ProductCards';
import { PRODUCT_CARDS } from '@/lib/constants/product-cards';
import { PRODUCT_COLORS, productColor } from '@/lib/constants/product-colors';

/** 제품별 칩 색 (Penta 디자인 §13) — 매핑 상수 1곳, 홈 카드, 표 분류 칩 */
describe('productColor', () => {
  it.each([
    ['WAPPLES', 'wapples'],
    ['D.AMO', 'damo'],
    ['iSIGN', 'isign'],
    ['iSIGN PKI', 'isign'],
    ['Cloudbric', 'cloudbric'],
    [' wapples ', 'wapples'],
  ])('%s → --penta-product-%s', (name, token) => {
    expect(productColor(name)).toBe(`var(--penta-product-${token})`);
  });

  it.each([['기타'], [''], [null], [undefined]])('%s → null (기존 중립 스타일)', (name) => {
    expect(productColor(name)).toBeNull();
  });

  it('값은 L1 제품 토큰만 가리킨다', () => {
    for (const value of Object.values(PRODUCT_COLORS))
      expect(value).toMatch(/^var\(--penta-product-(wapples|damo|isign|cloudbric)\)$/);
  });
});

describe('홈 제품 카드', () => {
  it('아이콘 사각형 = 제품 색, 아이콘 = N900, "가격 정책 보기 →" 글자 = Primary 600', () => {
    expect(PRODUCT_CARDS.map((card) => card.accentSoft)).toEqual([
      'var(--penta-product-wapples)',
      'var(--penta-product-damo)',
      'var(--penta-product-isign)',
      'var(--penta-product-cloudbric)',
    ]);
    render(<ProductCards />);
    const card = screen.getByRole('link', { name: 'D.AMO 가격 정책 보기' });
    const square = card.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(square).toHaveStyle({ background: 'var(--penta-product-damo)' });
    expect(square.firstElementChild).toHaveClass('bg-neutral-900');
    expect(within(card).getByText('가격 정책 보기 →')).toHaveStyle({
      color: 'var(--penta-primary-600)',
    });
  });
});

describe('ProductChip (표 분류 칸)', () => {
  it.each([
    ['WAPPLES', 'wapples'],
    ['iSIGN PKI', 'isign'],
  ])('%s: 읽기 전용 배지 — 제품 색 배경 + N900, 밀집 행 높이용 py-0.5·12px', (name, token) => {
    render(<ProductChip product={name} />);
    const chip = screen.getByText(name);
    expect(chip.tagName).toBe('SPAN');
    expect(chip).toHaveStyle({ background: `var(--penta-product-${token})` });
    expect(chip).toHaveClass('text-neutral-900', 'rounded-pill', 'py-0.5', 'text-[12px]');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('4개 제품 밖 값은 평문 그대로(칩 없음)', () => {
    const { container } = render(<ProductChip product="기타 제품" />);
    expect(container.innerHTML).toBe('기타 제품');
  });
});

describe('조달 품목 표 제품 칸 (합성 값)', () => {
  const productCell = itemColumns().find((column) => column.id === 'product')!;
  const cell = (product: string) =>
    render(<>{productCell.cell!({ product } as ItemRowView)}</>).container;

  it.each([
    ['WAPPLES', 'wapples'],
    ["D'Amo", 'damo'],
    ['D.AMO', 'damo'],
    ['iSIGN+ PKI', 'isign'],
    ['Cloudbric', 'cloudbric'],
  ])('%s → 제품 색 칩(글자는 원래 값)', (product, token) => {
    const chip = cell(product).querySelector('[data-product-chip]');
    expect(chip).toHaveStyle({ background: `var(--penta-product-${token})` });
    expect(chip).toHaveTextContent(product);
    expect(chip).toHaveClass('text-neutral-900', 'py-0.5');
  });

  it('정규화되지 않는 값은 평문', () => {
    const container = cell('가상 기타 제품');
    expect(container.querySelector('[data-product-chip]')).toBeNull();
    expect(container).toHaveTextContent('가상 기타 제품');
  });
});
