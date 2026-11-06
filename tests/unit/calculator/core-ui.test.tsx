import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FamilyPreload, QuoteDocumentView, QuoteItemView } from '@/features/calculator/types';

/** D.AMO 코어 단가 계산기 화면 (Plan docs/specs/damo-core-price.md §4·§6) — Server Action 모킹 */
const mocks = vi.hoisted(() => ({ items: vi.fn(), options: vi.fn() }));

vi.mock('@/features/calculator/actions', () => ({
  listQuoteItemsAction: mocks.items,
  listQuoteOptionsAction: mocks.options,
  saveQuoteAction: vi.fn(),
  listMyQuotesAction: vi.fn(async () => ({ ok: true, data: [] })),
  deleteQuoteAction: vi.fn(),
}));
vi.mock('@/features/page-state/draft-actions', () => ({
  saveDraftAction: vi.fn(async () => ({ ok: true, data: { status: 'saved' } })),
  deleteDraftAction: vi.fn(async () => ({ ok: true, data: { status: 'deleted' } })),
  readDraftAction: vi.fn(async () => ({ ok: true, data: null })),
}));

const { QuoteCalculator } = await import('@/features/calculator/QuoteCalculator');
const { QuoteSheet } = await import('@/features/calculator/QuoteSheet');

const CORE_ITEM: QuoteItemView = {
  itemCode: 'DA-KE-01',
  itemName: 'D.AMO KE',
  unitPrice: '10000000.00',
  currency: 'KRW',
  priceType: '정상판매',
  kind: '본품',
  hasCorePrice: true,
  baseCoreCount: 4,
  unitPricePerCore: '1500000.00',
};
const PLAIN_ITEM: QuoteItemView = {
  ...CORE_ITEM,
  itemCode: 'DA-SVC-01',
  itemName: 'D.AMO 기술지원',
  unitPrice: '2000000.00',
  hasCorePrice: false,
  baseCoreCount: 0,
  unitPricePerCore: '0.00',
};
const PROCUREMENT_ITEM: QuoteItemView = {
  ...CORE_ITEM,
  itemCode: 'DA-PRC-01',
  itemName: 'D.AMO 조달',
  baseCoreCount: 0,
};
const PRELOAD: FamilyPreload[] = [
  {
    family: 'D.AMO',
    priceTypes: [{ priceType: '정상판매', count: 3 }],
    categories: { majors: ['D.AMO'], mids: [], minorsByMid: {}, hasMaster: false },
    groups: [],
    hardware: [],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.items.mockResolvedValue({ ok: true, data: [CORE_ITEM, PLAIN_ITEM, PROCUREMENT_ITEM] });
  mocks.options.mockResolvedValue({ ok: true, data: { parts: [], bundles: [], mapped: false } });
});

async function pick(item: QuoteItemView) {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: `${item.itemName} (${item.itemCode})` }),
  );
  return user;
}

describe('계산기 STEP3 코어 수 (§4, §6)', () => {
  it('품목 목록: 코어 품목(기준 1 이상)만 "기준 N코어" 배지', async () => {
    render(<QuoteCalculator userId="u" preload={PRELOAD} savedQuotes={[]} />);
    const list = await screen.findByRole('list', { name: '품목 목록' });
    await screen.findByRole('button', { name: `${CORE_ITEM.itemName} (${CORE_ITEM.itemCode})` });
    expect(within(list).getAllByText(/^기준 \d+코어$/)).toHaveLength(1);
    expect(within(list).getByText('기준 4코어')).toBeInTheDocument();
  });

  it('코어 품목: 입력 기본값 = 기준, 6 입력 → 내역 줄·금액이 공식과 같다, 기준 미만 → 오류·담기 비활성', async () => {
    render(<QuoteCalculator userId="u" preload={PRELOAD} savedQuotes={[]} />);
    const user = await pick(CORE_ITEM);
    const input = screen.getByLabelText('코어 수');
    expect(input).toHaveValue(4);
    expect(screen.getByText('기준 4코어 포함 · 초과 1코어당 1,500,000원')).toBeInTheDocument();
    expect(screen.getByTestId('core-breakdown')).toHaveTextContent(
      '기본 단가(4코어) 10,000,000원 · 추가 코어 없음',
    );
    expect(screen.getByTestId('pre-discount')).toHaveTextContent('10,000,000원');

    await user.click(screen.getByRole('button', { name: '코어 수 증가' }));
    await user.click(screen.getByRole('button', { name: '코어 수 증가' }));
    expect(input).toHaveValue(6);
    expect(screen.getByTestId('core-breakdown')).toHaveTextContent(
      '기본 단가(4코어) 10,000,000원 + 추가 2코어 × 1,500,000원 = 13,000,000원',
    );
    expect(screen.getByTestId('pre-discount')).toHaveTextContent('13,000,000원');

    await user.clear(input);
    await user.type(input, '3');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('기준 4코어 이상으로 입력하세요')).toBeInTheDocument();
    expect(input.getAttribute('aria-describedby')).toContain(
      screen.getByText('기준 4코어 이상으로 입력하세요').id,
    );
    expect(screen.getByRole('button', { name: /장바구니에 담기/ })).toBeDisabled();
    expect(screen.queryByTestId('core-breakdown')).toBeNull();

    await user.clear(input);
    await user.type(input, '6');
    expect(screen.getByRole('button', { name: /장바구니에 담기/ })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /장바구니에 담기/ }));
    expect(await screen.findByText(/정상판매 · 6코어 · × 1/)).toBeInTheDocument();
  });

  it('N 품목·Y + 기준 0(조달, D4): 코어 입력 없음, 다른 품목으로 바꾸면 기준으로 초기화 (D5)', async () => {
    render(<QuoteCalculator userId="u" preload={PRELOAD} savedQuotes={[]} />);
    let user = await pick(PLAIN_ITEM);
    expect(screen.queryByLabelText('코어 수')).toBeNull();
    expect(screen.queryByTestId('core-breakdown')).toBeNull();
    user = await pick(PROCUREMENT_ITEM);
    expect(screen.queryByLabelText('코어 수')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: `${CORE_ITEM.itemName} (${CORE_ITEM.itemCode})` }),
    );
    await user.click(screen.getByRole('button', { name: '코어 수 증가' }));
    expect(screen.getByLabelText('코어 수')).toHaveValue(5);
    await user.click(
      screen.getByRole('button', { name: `${PLAIN_ITEM.itemName} (${PLAIN_ITEM.itemCode})` }),
    );
    await user.click(
      screen.getByRole('button', { name: `${CORE_ITEM.itemName} (${CORE_ITEM.itemCode})` }),
    );
    expect(screen.getByLabelText('코어 수')).toHaveValue(4);
  });
});

describe('견적서 코어 하위 줄 (§4)', () => {
  const line: QuoteDocumentView['lines'][number] = {
    lineNo: 1,
    kind: 'item',
    name: 'D.AMO KE',
    itemCode: 'DA-KE-01',
    priceType: '정상판매',
    qty: 2,
    unitPrice: '13000000.00',
    currency: 'KRW',
    discountRate: '0',
    preDiscount: '26000000.00',
    lineTotal: '26000000.00',
    options: [],
    core: { cores: 6, baseCoreCount: 4, unitPricePerCore: 1_500_000, baseUnitPrice: 10_000_000 },
  };
  const document: QuoteDocumentView = {
    id: 'q',
    quoteNo: 'Q-2026-0100',
    title: 't',
    productFamily: 'D.AMO',
    summary: null,
    totalAmount: '26000000',
    currency: 'KRW',
    subtotals: [{ currency: 'KRW', amount: 26_000_000 }],
    createdAt: '2026-11-05T00:00:00.000Z',
    ownerName: '홍길동',
    lines: [
      line,
      { ...line, lineNo: 2, core: { ...line.core!, cores: 4 } },
      { ...line, lineNo: 3, core: null },
    ],
  };

  it('추가 코어 줄 / 기준 그대로면 "기준 N코어" / 옛 라인은 없음', () => {
    render(<QuoteSheet document={document} />);
    // 표(데스크톱)와 카드(max-md, 모바일 UI M1) 모두 같은 코어 줄
    for (const scope of [
      screen.getByRole('table', { name: '견적 품목 표' }),
      screen.getByRole('list', { name: '견적 품목' }),
    ]) {
      const rows = within(scope).getAllByTestId('core-line');
      expect(rows.map((row) => row.textContent)).toEqual([
        '+ 추가 코어 2 × 1,500,000원 (기준 4코어 포함, 총 6코어)',
        '기준 4코어',
      ]);
    }
  });

  it('MOB-SR-101.1·101.2·101.4·102.1: 표는 max-md:hidden, 카드(md:hidden)는 품목명·수량×단가·할인·금액, 옵션·코어 줄 12px, 합계는 max-md sticky', () => {
    const withOption = {
      ...line,
      lineNo: 4,
      core: null,
      discountRate: '10',
      options: [{ label: '파츠', name: 'HA 키트', itemCode: 'OPT-1', qty: 2, unitPrice: 500_000 }],
    } satisfies QuoteDocumentView['lines'][number];
    render(<QuoteSheet document={{ ...document, lines: [line, withOption] }} />);
    const table = screen.getByRole('table', { name: '견적 품목 표' });
    expect(table.parentElement!.className).toContain('max-md:hidden');
    const list = screen.getByRole('list', { name: '견적 품목' });
    expect(list.className).toContain('md:hidden');
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('D.AMO KE');
    expect(cards[0]).toHaveTextContent('2 × 13,000,000원 · 할인 0%');
    expect(cards[0]).toHaveTextContent('26,000,000원');
    const option = within(cards[1]!).getByText(/HA 키트/);
    expect(option).toHaveTextContent('+ 파츠 HA 키트 (OPT-1) × 2 · 500,000원');
    expect(option.className).toContain('text-[12px]');
    expect(within(cards[1]!).getByText(/할인 10%/)).toBeInTheDocument();
    // 원가 키 없음 (MOB-SR-001.5) — 문서 모델에 원가가 없다
    expect(list.textContent).not.toMatch(/원가/);
    const total = screen.getByRole('region', { name: '견적 합계' });
    expect(total.className).toContain('max-md:sticky');
    expect(total.className).toContain('max-md:bottom-0');
  });
});
