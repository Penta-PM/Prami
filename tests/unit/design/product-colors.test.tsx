import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Chip } from '@/features/calculator/chips';
import { ProductCards } from '@/features/home/ProductCards';
import { PRODUCT_CARDS } from '@/lib/constants/product-cards';
import { PRODUCT_COLORS, productColor } from '@/lib/constants/product-colors';

/** 제품별 칩 색 (Penta 디자인 §13) — 매핑 상수 1곳, 홈 카드, 계산기 선택 칩 */
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

describe('계산기 Chip product', () => {
  const noop = () => undefined;

  it('기본: 제품 색 배경 + N900, hover 1px N900/40, aria-pressed=false', () => {
    render(
      <Chip active={false} product="iSIGN PKI" onClick={noop}>
        iSIGN PKI
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'iSIGN PKI' });
    expect(chip).toHaveStyle({ background: 'var(--penta-product-isign)' });
    expect(chip).toHaveClass(
      'text-neutral-900',
      'hover:inset-ring',
      'hover:inset-ring-neutral-900/40',
    );
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip).not.toHaveClass('bg-surface-muted', 'font-bold');
  });

  it('선택: 같은 배경 + 2px N900 안쪽 테두리 + 굵게 + aria-pressed (색만으로 구분하지 않음)', () => {
    render(
      <Chip active product="Cloudbric" onClick={noop}>
        Cloudbric
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Cloudbric' });
    expect(chip).toHaveStyle({ background: 'var(--penta-product-cloudbric)' });
    expect(chip).toHaveClass(
      'inset-ring-2',
      'inset-ring-neutral-900',
      'font-bold',
      'text-neutral-900',
    );
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).not.toHaveClass('bg-surface-inverse', 'text-text-inverse');
  });

  it('4개 제품 밖·product 없음: 기존 중립/반전 칩', () => {
    render(
      <>
        <Chip active product="기타" onClick={noop}>
          기타
        </Chip>
        <Chip active={false} onClick={noop}>
          연간
        </Chip>
      </>,
    );
    expect(screen.getByRole('button', { name: '기타' })).toHaveClass('bg-surface-inverse');
    expect(screen.getByRole('button', { name: '연간' })).toHaveClass('bg-surface-muted');
    expect(screen.getByRole('button', { name: '기타' })).not.toHaveAttribute('style');
  });
});
