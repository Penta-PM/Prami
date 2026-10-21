import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CartDraftRestore,
  FamilyPreload,
  MarginDraftRestore,
  QuoteDraftRestore,
  QuoteItemView,
} from '@/features/calculator/types';

/**
 * 입력 초안 화면 (page-state-memory §2.4·§2.5·§2.6): 복원 초기 props(하이드레이션 안전)·복원 배너 role="status" + [새로 시작]·
 * 최신가 갱신/판매 중지 안내·1s 디바운스 저장(원가 필드 없음)·'견적 초기화' = cart 초안 삭제·예전 sessionStorage 키 삭제·
 * 탭 재표시 시 서버 초안 다시 읽기·사용자 설정 전역 초기화(확인 모달·문구, 열 레이아웃 localStorage 유지).
 */
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  clear: vi.fn(),
  items: vi.fn(),
  options: vi.fn(),
}));

vi.mock('@/features/page-state/draft-actions', () => ({
  saveDraftAction: mocks.save,
  deleteDraftAction: mocks.remove,
  readDraftAction: mocks.read,
  clearSavedPageStateAction: mocks.clear,
}));
vi.mock('@/features/calculator/actions', () => ({
  listQuoteItemsAction: mocks.items,
  listQuoteOptionsAction: mocks.options,
  saveQuoteAction: vi.fn(),
  listMyQuotesAction: vi.fn(async () => ({ ok: true, data: [] })),
  deleteQuoteAction: vi.fn(),
}));
vi.mock('@/features/costs/actions', () => ({ calculateNetSalesAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/calculator',
  useSearchParams: () => new URLSearchParams(),
}));

const { QuoteCalculator } = await import('@/features/calculator/QuoteCalculator');
const { MarginCalculator } = await import('@/features/calculator/MarginCalculator');
const { CalculatorTabs } = await import('@/features/calculator/CalculatorTabs');
const { PageStateResetSection, PAGE_STATE_RESET_NOTICE } =
  await import('@/features/settings/PageStateResetSection');

const ITEM: QuoteItemView = {
  itemCode: 'P10100015',
  itemName: 'Wapples-500 (H500 T2)',
  unitPrice: '21000000.00',
  currency: 'KRW',
  priceType: '정상판매',
  kind: '본품',
};
const PRELOAD: FamilyPreload[] = [
  {
    family: 'WAPPLES',
    priceTypes: [
      { priceType: '정상판매', count: 77 },
      { priceType: 'ASP', count: 55 },
    ],
    categories: { majors: ['WAPPLES'], mids: [], minorsByMid: {}, hasMaster: false },
    groups: [],
    hardware: [],
  },
  {
    family: 'D.AMO',
    priceTypes: [{ priceType: '정상판매', count: 4 }],
    categories: { majors: ['D.AMO'], mids: [], minorsByMid: {}, hasMaster: false },
    groups: [],
    hardware: [],
  },
];

const META = { updatedAt: '2026-10-20T05:07:00.000Z', restoredAt: '10-20 14:07' };

const QUOTE_RESTORE: QuoteDraftRestore = {
  ...META,
  notices: ['가격이 바뀐 품목 1건을 최신가로 갱신했습니다'],
  dirty: true,
  form: {
    family: 'WAPPLES',
    priceType: 'ASP',
    mid: null,
    minor: null,
    selected: { ...ITEM, priceType: 'ASP' },
    qty: 3,
    parts: [],
    bundles: [],
    rate: 10,
    target: '',
  },
};

const CART_RESTORE: CartDraftRestore = {
  ...META,
  notices: [
    '가격이 바뀐 품목 2건을 최신가로 갱신했습니다',
    '1건은 더 이상 판매하지 않아 제외했습니다',
  ],
  dirty: true,
  lines: [
    {
      kind: 'item',
      itemCode: 'P10100015',
      name: 'Wapples-500 (H500 T2)',
      priceType: '정상판매',
      qty: 1,
      unitPrice: 21_000_000,
      currency: 'KRW',
      parts: [],
      bundles: [],
      groupItems: [],
      discountRate: 0,
    },
  ],
};

const MARGIN_RESTORE: MarginDraftRestore = {
  ...META,
  notices: [],
  dirty: false,
  values: { sellingPrice: '1200000', quantity: '3', discountRate: '10' },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mocks.save.mockResolvedValue({ ok: true, data: { status: 'saved' } });
  mocks.remove.mockResolvedValue({ ok: true, data: { status: 'deleted' } });
  mocks.read.mockResolvedValue({ ok: true, data: null });
  mocks.clear.mockResolvedValue({ ok: true, data: { viewStates: 2, drafts: 3 } });
  mocks.items.mockResolvedValue({ ok: true, data: [ITEM] });
  mocks.options.mockResolvedValue({ ok: true, data: { parts: [], bundles: [], mapped: false } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('견적 계산기 · 장바구니 복원', () => {
  it('RSC 초안이 첫 렌더 값 — 선택 품목·수량·장바구니 + 복원 배너 2개(시각·최신가/제외 안내)', () => {
    render(
      <QuoteCalculator
        userId="u"
        preload={PRELOAD}
        savedQuotes={[]}
        restored={{ quote: QUOTE_RESTORE, cart: CART_RESTORE }}
      />,
    );
    const quoteBanner = screen.getByRole('status', { name: '견적 입력 복원 안내' });
    expect(quoteBanner).toHaveTextContent('이전 작업을 복원했습니다 (10-20 14:07) · 새로 시작');
    expect(quoteBanner).toHaveTextContent('가격이 바뀐 품목 1건을 최신가로 갱신했습니다');
    const cartBanner = screen.getByRole('status', { name: '장바구니 복원 안내' });
    expect(cartBanner).toHaveTextContent('가격이 바뀐 품목 2건을 최신가로 갱신했습니다');
    expect(cartBanner).toHaveTextContent('1건은 더 이상 판매하지 않아 제외했습니다');
    expect(
      screen.getByRole('button', { name: /장바구니에 담기 \(Wapples-500 \(H500 T2\) × 3\)/ }),
    ).toBeEnabled();
    expect(screen.getByLabelText('장바구니')).toHaveTextContent('Wapples-500 (H500 T2)');
    expect(screen.getByTestId('quote-total')).toHaveTextContent('21,000,000원');
  });

  it('하이드레이션 안전: 서버 HTML 과 클라이언트 첫 렌더가 같다(경고 0)', async () => {
    const element = (
      <QuoteCalculator
        userId="u"
        preload={PRELOAD}
        savedQuotes={[]}
        restored={{ quote: QUOTE_RESTORE, cart: CART_RESTORE }}
      />
    );
    const html = renderToString(element);
    expect(html).toContain('이전 작업을 복원했습니다 (<!-- -->10-20 14:07');
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(container, element, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors.mock.calls.map(String).join('\n')).not.toMatch(/hydrat/i);
    errors.mockRestore();
    container.remove();
  });

  it('복원 직후 화면 값이 달라졌으면(최신가 갱신) 1s 뒤 다시 저장 — 장바구니는 id·표시 금액 없이', async () => {
    render(
      <QuoteCalculator
        userId="u"
        preload={PRELOAD}
        savedQuotes={[]}
        restored={{ cart: CART_RESTORE }}
      />,
    );
    expect(mocks.save).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled(), { timeout: 2500 });
    const call = mocks.save.mock.calls.find(([input]) => input.draftKey === 'cart')![0];
    expect(call).toMatchObject({ draftKey: 'cart', version: 1 });
    expect(call.data.lines[0]).not.toHaveProperty('id');
    expect(call.data.lines[0]).not.toHaveProperty('lineTotal');
    expect(call.data.lines[0].unitPrice).toBe(21_000_000);
  });

  it('[새로 시작] (견적 입력): quote·group-solution 초안 삭제 + 기본 상태, 배너 사라짐, 빈 상태는 다시 저장하지 않음', async () => {
    render(
      <QuoteCalculator
        userId="u"
        preload={PRELOAD}
        savedQuotes={[]}
        restored={{ quote: { ...QUOTE_RESTORE, dirty: false } }}
      />,
    );
    const banner = screen.getByRole('status', { name: '견적 입력 복원 안내' });
    await userEvent.click(within(banner).getByRole('button', { name: '새로 시작' }));
    expect(mocks.remove).toHaveBeenCalledWith({ draftKey: 'quote' });
    expect(mocks.remove).toHaveBeenCalledWith({ draftKey: 'group-solution' });
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: '견적 입력 복원 안내' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /품목을 선택하세요/ })).toBeDisabled();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("'견적 초기화' 와 장바구니 [새로 시작] 은 cart 초안을 바로 지운다", async () => {
    render(
      <QuoteCalculator
        userId="u"
        preload={PRELOAD}
        savedQuotes={[]}
        restored={{ cart: { ...CART_RESTORE, dirty: false } }}
      />,
    );
    const banner = screen.getByRole('status', { name: '장바구니 복원 안내' });
    await userEvent.click(within(banner).getByRole('button', { name: '새로 시작' }));
    expect(mocks.remove).toHaveBeenCalledWith({ draftKey: 'cart' });
    expect(screen.getByLabelText('장바구니')).toHaveTextContent('담긴 품목이 없습니다');
    mocks.remove.mockClear();
    await userEvent.click(screen.getByRole('button', { name: '견적 초기화' }));
    expect(mocks.remove).toHaveBeenCalledWith({ draftKey: 'cart' });
  });

  it('예전 sessionStorage 장바구니(prami.quote.cart.v1)는 불러오지 않고 지운다', () => {
    window.sessionStorage.setItem(
      'prami.quote.cart.v1',
      JSON.stringify({ lines: [{ ...CART_RESTORE.lines[0], id: 'x', name: '다른 사용자 품목' }] }),
    );
    render(<QuoteCalculator userId="u" preload={PRELOAD} savedQuotes={[]} />);
    expect(window.sessionStorage.getItem('prami.quote.cart.v1')).toBeNull();
    expect(screen.getByLabelText('장바구니')).not.toHaveTextContent('다른 사용자 품목');
    expect(screen.queryByRole('status', { name: /복원 안내/ })).not.toBeInTheDocument();
  });

  it('선택을 바꾸면 1s 디바운스로 quote 초안 저장 (견적 계산기 저장 필드)', async () => {
    render(<QuoteCalculator userId="u" preload={PRELOAD} savedQuotes={[]} />);
    await userEvent.click(
      within(screen.getByRole('group', { name: '단가 유형' })).getByRole('button', { name: /ASP/ }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(mocks.save.mock.calls[0]![0]).toEqual({
      draftKey: 'quote',
      version: 1,
      data: {
        family: 'WAPPLES',
        priceType: 'ASP',
        mid: null,
        minor: null,
        itemCode: null,
        unitPrice: null,
        qty: 1,
        parts: [],
        bundles: [],
        rate: 0,
        target: '',
      },
    });
  });

  it('탭이 다시 보일 때 편집 중이 아니면 서버 초안을 다시 읽어 반영한다 (다른 탭의 마지막 저장)', async () => {
    render(<QuoteCalculator userId="u" preload={PRELOAD} savedQuotes={[]} />);
    mocks.read.mockImplementation(async ({ draftKey }: { draftKey: string }) =>
      draftKey === 'cart'
        ? { ok: true, data: { ...CART_RESTORE, notices: [], dirty: false } }
        : { ok: true, data: null },
    );
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('장바구니')).toHaveTextContent('Wapples-500 (H500 T2)'),
    );
    expect(mocks.read).toHaveBeenCalledWith({ draftKey: 'cart' });
    // 받은 값은 다시 저장하지 않는다
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe('그룹 솔루션 복원', () => {
  const GROUP_ID = '22222222-0000-4000-8000-000000000001';
  const withGroup: FamilyPreload[] = [
    {
      ...PRELOAD[0]!,
      groups: [
        {
          id: GROUP_ID,
          productFamily: 'WAPPLES',
          name: 'WAPPLES 기본',
          items: [
            {
              itemCode: 'P2',
              itemName: '상세 A',
              defaultQty: 2,
              unitPrice: '1000.00',
              currency: 'KRW',
            },
          ],
        },
      ],
      hardware: [ITEM],
    },
  ];

  it('선택 그룹·하드웨어·상세 수량이 첫 렌더 값, [새로 시작]이면 그룹 초안도 지운다', async () => {
    render(
      <QuoteCalculator
        userId="u"
        preload={withGroup}
        savedQuotes={[]}
        restored={{
          group: {
            ...META,
            notices: [],
            dirty: false,
            selection: {
              family: 'WAPPLES',
              groupId: GROUP_ID,
              hardwareCode: '',
              items: { P2: { checked: true, qty: 5 } },
            },
          },
        }}
      />,
    );
    expect(screen.getByRole('status', { name: '견적 입력 복원 안내' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WAPPLES 기본' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('group-subtotal')).toHaveTextContent('5,000');
    await userEvent.click(screen.getByRole('button', { name: '새로 시작' }));
    expect(mocks.remove).toHaveBeenCalledWith({ draftKey: 'group-solution' });
    expect(screen.queryByTestId('group-subtotal')).not.toBeInTheDocument();
  });
});

describe('순매출 계산기 (원가 입력 제외)', () => {
  it('복원 배너 + 판매가·수량·할인율 복원, 원가는 빈 칸', () => {
    render(<MarginCalculator canSeeCost restored={MARGIN_RESTORE} />);
    expect(screen.getByRole('status', { name: '순매출 입력 복원 안내' })).toHaveTextContent(
      '이전 작업을 복원했습니다 (10-20 14:07)',
    );
    expect(screen.getByRole('textbox', { name: '정상 판매가 (단가)' })).toHaveValue('1200000');
    expect(screen.getByRole('textbox', { name: '판매 수량' })).toHaveValue('3');
    expect(screen.getByRole('textbox', { name: '원가 (단가)' })).toHaveValue('');
  });

  it('원가·기타 비용을 입력해도 저장 값에는 없다', async () => {
    render(<MarginCalculator canSeeCost />);
    await userEvent.type(screen.getByRole('textbox', { name: '정상 판매가 (단가)' }), '5000');
    await userEvent.type(screen.getByRole('textbox', { name: '원가 (단가)' }), '3000');
    await userEvent.type(screen.getByRole('textbox', { name: '기타 비용' }), '7');
    await waitFor(() => expect(mocks.save).toHaveBeenCalled(), { timeout: 2500 });
    const data = mocks.save.mock.calls.at(-1)![0].data;
    expect(data).toEqual({ sellingPrice: '5000', quantity: '1', discountRate: '0' });
    expect(JSON.stringify(mocks.save.mock.calls)).not.toMatch(/unitCost|miscCost|3000/);
  });

  it('[새로 시작]: margin 초안 삭제 + 처음 값', async () => {
    render(<MarginCalculator canSeeCost restored={MARGIN_RESTORE} />);
    await userEvent.click(screen.getByRole('button', { name: '새로 시작' }));
    expect(mocks.remove).toHaveBeenCalledWith({ draftKey: 'margin' });
    expect(screen.getByRole('textbox', { name: '정상 판매가 (단가)' })).toHaveValue('');
  });
});

describe('CalculatorTabs — 탭 전환 후에도 최신 입력 유지, 배너는 첫 진입에만', () => {
  it('순매출 → 견적 → 순매출: 서버 초안이 아니라 마지막 입력, 배너 없음', async () => {
    render(
      <CalculatorTabs
        userId="u"
        preload={PRELOAD}
        savedQuotes={[]}
        canSeeCost
        initialTab="margin"
        drafts={{ margin: MARGIN_RESTORE }}
      />,
    );
    const price = screen.getByRole('textbox', { name: '정상 판매가 (단가)' });
    await userEvent.clear(price);
    await userEvent.type(price, '777');
    await userEvent.click(screen.getByRole('radio', { name: '견적 계산기' }));
    await userEvent.click(screen.getByRole('radio', { name: '순매출 계산기' }));
    expect(screen.getByRole('textbox', { name: '정상 판매가 (단가)' })).toHaveValue('777');
    expect(screen.queryByRole('status', { name: '순매출 입력 복원 안내' })).not.toBeInTheDocument();
  });
});

describe('사용자 설정 — 저장된 화면·입력 초기화 (§2.6-3)', () => {
  it('문구, 확인 모달 후 전역 초기화, 표 열 레이아웃(localStorage)은 그대로', async () => {
    window.localStorage.setItem('prami.table.layout.v1:u:pricing', '{"widths":{"a":120}}');
    render(<PageStateResetSection />);
    expect(PAGE_STATE_RESET_NOTICE).toBe(
      "조회 조건과 작성 중 입력을 지웁니다. 표 열 너비·순서는 각 표의 '열 초기화'로 되돌립니다",
    );
    expect(screen.getAllByText(PAGE_STATE_RESET_NOTICE)[0]).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '저장된 화면·입력 초기화' }));
    expect(mocks.clear).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: '저장된 화면·입력 초기화' });
    await userEvent.click(within(dialog).getByRole('button', { name: '초기화' }));
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent(
      '저장된 화면·입력을 초기화했습니다',
    );
    expect(window.localStorage.getItem('prami.table.layout.v1:u:pricing')).toBe(
      '{"widths":{"a":120}}',
    );
  });
});
