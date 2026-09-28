import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { QuoteDocument } from '@/server/quotes/document';

/**
 * /share/quotes/[token] (AC-71): 토큰이 살아 있으면 읽기 전용 견적서(가견적 문구·품목·합계·만료 안내, 원가 없음),
 * 아니면 notFound(). 로그인 가드가 없다 — proxy matcher 에서 /share/ 를 제외한다.
 */
const state = vi.hoisted(() => ({
  shared: null as null | { document: QuoteDocument; expiresAt: string },
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/quotes/shares', () => ({ findSharedQuote: async () => state.shared }));
vi.mock('next/navigation', () => ({ notFound: state.notFound }));

const { default: SharedQuotePage } = await import('@/app/share/quotes/[token]/page');

const doc: QuoteDocument = {
  id: 'q1',
  quoteNo: 'Q-2026-0009',
  title: 'WAPPLES 견적 Q-2026-0009',
  productFamily: 'WAPPLES',
  summary: 'Wapples-500 (H500 T2) × 2',
  totalAmount: '21000000',
  currency: 'KRW',
  subtotals: [{ currency: 'KRW', amount: 21_000_000 }],
  createdAt: '2026-09-28T01:00:00.000Z',
  ownerName: '픽스처 사용자',
  lines: [
    {
      lineNo: 1,
      kind: 'item',
      name: 'Wapples-500 (H500 T2)',
      itemCode: 'P10100015',
      priceType: '정상판매',
      qty: 2,
      unitPrice: '12000000.00',
      currency: 'KRW',
      discountRate: '12.5',
      preDiscount: '24000000.00',
      lineTotal: '21000000.00',
      options: [{ label: '파츠', itemCode: 'P10800011', name: 'N_51080', unitPrice: 0, qty: 1 }],
    },
  ],
};

describe('/share/quotes/[token]', () => {
  it('살아 있는 토큰: 견적서 본문·가견적 문구·만료 안내, 원가 없음', async () => {
    state.shared = { document: doc, expiresAt: '2026-10-28T01:00:00.000Z' };
    render(await SharedQuotePage({ params: Promise.resolve({ token: 'a'.repeat(64) }) }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('WAPPLES 견적 Q-2026-0009');
    expect(screen.getByText('가견적 · 계약가 아님')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '견적 품목 표' })).toHaveTextContent(
      'Wapples-500 (H500 T2)',
    );
    expect(screen.getByRole('table', { name: '견적 품목 표' })).toHaveTextContent('+ 파츠 N_51080');
    expect(screen.getByTestId('share-total')).toHaveTextContent('21,000,000원');
    expect(screen.getByRole('note')).toHaveTextContent('공유 링크 만료');
    expect(screen.getByText('Q-2026-0009')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/원가|이익률/);
  });

  it('만료·폐기·없는 토큰: notFound()', async () => {
    state.shared = null;
    await expect(
      SharedQuotePage({ params: Promise.resolve({ token: 'b'.repeat(64) }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.notFound).toHaveBeenCalled();
  });
});
