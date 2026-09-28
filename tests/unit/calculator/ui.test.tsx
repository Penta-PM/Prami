import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FamilyPreload, QuoteItemView, SavedQuoteView } from '@/features/calculator/types';

/** 계산기 화면 — Server Action·라우터는 모킹. STEP 흐름·할인 동기화·장바구니·통화 혼합·저장/담기·순매출 잠금 */
const mocks = vi.hoisted(() => ({
  items: vi.fn(),
  options: vi.fn(),
  categories: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  margin: vi.fn(),
}));

vi.mock('@/features/calculator/actions', () => ({
  listQuoteItemsAction: mocks.items,
  listQuoteOptionsAction: mocks.options,
  listQuoteCategoriesAction: mocks.categories,
  saveQuoteAction: mocks.save,
  listMyQuotesAction: mocks.list,
  deleteQuoteAction: mocks.remove,
}));
vi.mock('@/features/costs/actions', () => ({ calculateNetSalesAction: mocks.margin }));

const { QuoteCalculator } = await import('@/features/calculator/QuoteCalculator');
const { MarginCalculator } = await import('@/features/calculator/MarginCalculator');
const { CartPanel } = await import('@/features/calculator/CartPanel');

const ITEM: QuoteItemView = {
  itemCode: 'P10100015',
  itemName: 'Wapples-500 (H500 T2)',
  unitPrice: '20000000.00',
  currency: 'KRW',
  priceType: '정상판매',
  kind: '본품',
};
const PART: QuoteItemView = {
  ...ITEM,
  itemCode: 'P10800011',
  itemName: 'N_51080',
  unitPrice: '500000.00',
  kind: '파츠',
};
const PRELOAD: FamilyPreload[] = [
  {
    family: 'WAPPLES',
    priceTypes: [
      { priceType: '정상판매', count: 77 },
      { priceType: 'ASP', count: 55 },
    ],
    categories: { majors: ['WAPPLES'], mids: [], minors: [], hasMaster: false },
    groups: [
      {
        id: '22222222-0000-4000-8000-000000000001',
        productFamily: 'WAPPLES',
        name: 'WAPPLES 기본',
        items: [
          {
            itemCode: 'P2',
            itemName: '상세 A',
            defaultQty: 2,
            unitPrice: '100500.00',
            currency: 'KRW',
          },
        ],
      },
    ],
    hardware: [ITEM],
  },
  {
    family: 'D.AMO',
    priceTypes: [{ priceType: '정상판매', count: 4 }],
    categories: { majors: ['D.AMO'], mids: [], minors: [], hasMaster: false },
    groups: [],
    hardware: [],
  },
];
const SAVED: SavedQuoteView = {
  id: 'q1',
  quoteNo: 'Q-2026-0001',
  productFamily: 'WAPPLES',
  title: 't',
  summary: 'Wapples-500 (H500 T2) × 2',
  totalAmount: '35875000',
  currency: 'KRW',
  createdAt: '2026-09-29T01:00:00.000Z',
  ownerUserId: 'u',
  lines: [
    {
      kind: 'item',
      itemCode: 'P10100015',
      groupId: null,
      priceType: '정상판매',
      name: 'Wapples-500 (H500 T2)',
      qty: 2,
      unitPrice: '20000000.00',
      currency: 'KRW',
      parts: [{ itemCode: 'P10800011', itemName: 'N_51080', unitPrice: 500000 }],
      bundles: [],
      groupItems: [],
      discountRate: '12.5',
      preDiscount: '41000000.00',
      lineTotal: '35875000.00',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mocks.items.mockResolvedValue({ ok: true, data: [ITEM] });
  mocks.options.mockResolvedValue({ ok: true, data: { parts: [PART], bundles: [], mapped: true } });
  mocks.list.mockResolvedValue({ ok: true, data: [SAVED] });
});

describe('QuoteCalculator', () => {
  it('STEP1 단가유형 = DB 목록, STEP3 품목 선택·파츠 체크·수량 → 할인 12.5% → 35,875,000원 → 장바구니 (AC-60~62)', async () => {
    render(<QuoteCalculator preload={PRELOAD} savedQuotes={[]} />);
    const priceTypes = within(screen.getByRole('group', { name: '단가 유형' })).getAllByRole(
      'button',
    );
    expect(priceTypes.map((chip) => chip.textContent)).toEqual(['정상판매77건', 'ASP55건']);
    expect(priceTypes[0]).toHaveAttribute('aria-pressed', 'true');
    await vi.waitFor(() =>
      expect(mocks.items).toHaveBeenCalledWith({
        family: 'WAPPLES',
        priceType: '정상판매',
        mid: undefined,
        minor: undefined,
      }),
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Wapples-500 (H500 T2) (P10100015)' }),
    );
    await vi.waitFor(() =>
      expect(mocks.options).toHaveBeenCalledWith({
        family: 'WAPPLES',
        priceType: '정상판매',
        modelItemCode: 'P10100015',
      }),
    );
    expect(await screen.findByText(/이 모델에 등록된 장착 가능 파츠만/)).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('group', { name: 'STEP 4 · 파츠' })).getByRole('checkbox'),
    );
    await userEvent.click(screen.getByRole('button', { name: '수량 증가' }));
    expect(screen.getByTestId('pre-discount')).toHaveTextContent('41,000,000원');

    const slider = screen.getByRole('slider', { name: '할인율' });
    await userEvent.type(
      screen.getByRole('spinbutton', { name: /^목표 금액으로 역산/ }),
      '30000000',
    );
    expect(screen.getByTestId('discount-rate')).toHaveTextContent('26.8%');
    expect(slider).toHaveValue('26.8');
    // 슬라이더 조작 → 목표금액 비움
    fireEvent.change(slider, { target: { value: '30' } });
    expect(screen.getByTestId('discount-rate')).toHaveTextContent('30%');
    expect(screen.getByRole('spinbutton', { name: /^목표 금액으로 역산/ })).toHaveValue(null);

    await userEvent.type(
      screen.getByRole('spinbutton', { name: /^목표 금액으로 역산/ }),
      '35875000',
    );
    expect(screen.getByTestId('discount-rate')).toHaveTextContent('12.5%');
    expect(screen.getByTestId('line-total')).toHaveTextContent('35,875,000원');

    await userEvent.click(screen.getByRole('button', { name: /장바구니에 담기 \(Wapples-500/ }));
    expect(screen.getByRole('status')).toHaveTextContent('장바구니에 담았습니다');
    expect(screen.getByLabelText('장바구니')).toHaveTextContent('Wapples-500 (H500 T2)');
    expect(screen.getByTestId('quote-total')).toHaveTextContent('35,875,000원');
    expect(JSON.parse(window.sessionStorage.getItem('prami.quote.cart.v1')!).lines).toHaveLength(1);
  });

  it('통화 혼합 → 통화별 소계 (AC-65); 저장 → Q 번호 status + 목록 갱신; 담기 → 라인 복원; 삭제 (AC-63)', async () => {
    mocks.items.mockResolvedValue({
      ok: true,
      data: [
        ITEM,
        { ...ITEM, itemCode: 'PUSD', itemName: 'USD Item', unitPrice: '10.00', currency: 'USD' },
      ],
    });
    mocks.options.mockResolvedValue({ ok: true, data: { parts: [], bundles: [], mapped: false } });
    mocks.save.mockResolvedValue({
      ok: true,
      data: { id: 'q2', quoteNo: 'Q-2026-0002', totalAmount: '0', currency: null, lineCount: 2 },
    });
    mocks.remove.mockResolvedValue({ ok: true, data: { id: 'q1', quoteNo: 'Q-2026-0001' } });
    render(<QuoteCalculator preload={PRELOAD} savedQuotes={[SAVED]} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Wapples-500 (H500 T2) (P10100015)' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /장바구니에 담기 \(/ }));
    await userEvent.click(screen.getByRole('button', { name: 'USD Item (PUSD)' }));
    await userEvent.click(screen.getByRole('button', { name: /장바구니에 담기 \(/ }));
    expect(screen.queryByTestId('quote-total')).not.toBeInTheDocument();
    const note = screen.getByRole('note', { name: '통화별 소계' });
    expect(note).toHaveTextContent('20,000,000원');
    expect(note).toHaveTextContent('10 USD');

    await userEvent.click(screen.getByRole('button', { name: '견적 저장' }));
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        productFamily: 'WAPPLES',
        lines: [
          expect.objectContaining({ itemCode: 'P10100015' }),
          expect.objectContaining({ currency: 'USD' }),
        ],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('견적을 저장했습니다: Q-2026-0002');
    expect(screen.getByLabelText('장바구니')).toHaveTextContent('담긴 품목이 없습니다');
    expect(mocks.list).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Q-2026-0001 담기' }));
    expect(screen.getByLabelText('장바구니')).toHaveTextContent(
      '정상판매 · 파츠 1 · 할인 12.5% · × 2',
    );
    expect(screen.getByTestId('quote-total')).toHaveTextContent('35,875,000원');

    await userEvent.click(screen.getByRole('button', { name: '전체보기' }));
    const dialog = screen.getByRole('dialog', { name: '내 견적 목록' });
    expect(within(dialog).getByRole('table', { name: '견적 목록 표' })).toHaveTextContent(
      'Q-2026-0001',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Q-2026-0001 삭제' }));
    expect(mocks.remove).toHaveBeenCalledWith({ id: 'q1' });
  });

  it('그룹 솔루션: 그룹 칩 → 하드웨어·상세 제품 수량 → 그룹 소계 → 그룹 라인 담기 (AC-33 UI)', async () => {
    render(<QuoteCalculator preload={PRELOAD} savedQuotes={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'WAPPLES 기본' }));
    expect(screen.getByTestId('group-subtotal')).toHaveTextContent('20,201,000원');
    await userEvent.click(screen.getByRole('button', { name: '상세 A 수량 감소' }));
    expect(screen.getByTestId('group-subtotal')).toHaveTextContent('20,100,500원');
    await userEvent.click(screen.getByRole('button', { name: '+ 그룹 장바구니에 담기' }));
    expect(screen.getByLabelText('장바구니')).toHaveTextContent(
      'WAPPLES 기본 · Wapples-500 (H500 T2)',
    );
    expect(screen.getByLabelText('장바구니')).toHaveTextContent('상세 1');
    expect(screen.getByTestId('quote-total')).toHaveTextContent('20,100,000원');
  });
});

describe('MarginCalculator (AC-64)', () => {
  it('USER: 원가 입력 잠금 "관리자만 조회 가능", 결과에 원가·이익률 비공개', async () => {
    mocks.margin.mockResolvedValue({
      ok: true,
      data: {
        grossAmount: '2000.00',
        discountAmount: '200.00',
        netAmount: '1800.00',
        miscAmount: '100.00',
        costLocked: true,
      },
    });
    render(<MarginCalculator canSeeCost={false} />);
    expect(screen.getByRole('status', { name: '원가 잠금' })).toHaveTextContent(
      '관리자만 조회 가능',
    );
    await userEvent.type(screen.getByLabelText('정상 판매가 (단가)'), '1000');
    await userEvent.clear(screen.getByLabelText('판매 수량'));
    await userEvent.type(screen.getByLabelText('판매 수량'), '2');
    await userEvent.type(screen.getByLabelText('기타 비용'), '100');
    await userEvent.click(screen.getByRole('button', { name: '계산' }));
    expect(mocks.margin).toHaveBeenCalledWith({
      sellingPrice: 1000,
      quantity: 2,
      discountRate: 0,
      unitCost: null,
      miscCost: 100,
    });
    expect(await screen.findByTestId('margin-net')).toHaveTextContent('1,700원');
    const result = screen.getByLabelText('순매출 결과');
    expect(result).toHaveTextContent('비공개');
    expect(result).not.toHaveTextContent('%');
  });

  it('ADMIN: 원가 입력 → 원가·이익률 표시', async () => {
    mocks.margin.mockResolvedValue({
      ok: true,
      data: {
        grossAmount: '2000.00',
        discountAmount: '0.00',
        netAmount: '2000.00',
        miscAmount: '0.00',
        cost: { totalCost: '1000.00', profit: '1000.00', marginRate: '50.0' },
        costLocked: false,
      },
    });
    render(<MarginCalculator canSeeCost />);
    await userEvent.type(screen.getByLabelText('정상 판매가 (단가)'), '1000');
    await userEvent.type(screen.getByLabelText('원가 (단가)'), '500');
    await userEvent.click(screen.getByRole('button', { name: '계산' }));
    expect(mocks.margin).toHaveBeenCalledWith(expect.objectContaining({ unitCost: 500 }));
    expect(await screen.findByTestId('margin-net')).toHaveTextContent('1,000원');
    expect(screen.getByLabelText('순매출 결과')).toHaveTextContent('50.0%');
  });
});

describe('CartPanel', () => {
  it('견적서 출력·공유는 PR-8 자리표시자(비활성), 저장은 장바구니가 비어 있으면 비활성', () => {
    render(
      <CartPanel
        lines={[]}
        saved={[]}
        isPending={false}
        onRemove={vi.fn()}
        onReset={vi.fn()}
        onSave={vi.fn()}
        onReload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '견적서 출력' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '견적 공유' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '견적 저장' })).toBeDisabled();
    expect(screen.getByTestId('quote-total')).toHaveTextContent('0원');
  });
});
