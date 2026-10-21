import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Modal } from '@/components/ui';
import type { PriceRowView } from '@/features/pricing/types';

/**
 * 가격 변동 이력 모달 (price-change-history-modal §2.2~2.4) — Server Action·라우터는 모킹.
 * 관리 화면 + pricing.write(withPriceChange) 에서만 — 조회 화면(/pricing)은 칸 버튼·모달·드로어 버튼 모두 없다
 * (pricing-view-hide-price-change §2, Q-V1 = B).
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  detail: vi.fn(),
  history: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => '/pricing',
}));
vi.mock('@/features/pricing/actions', () => ({
  getPriceRowDetailAction: mocks.detail,
  getPriceHistoryAction: mocks.history,
  createPricePolicyAction: vi.fn(),
  updatePricePolicyAction: vi.fn(),
  deletePricePolicyAction: vi.fn(),
  lookupItemAction: vi.fn(),
}));

const { PricingBrowser } = await import('@/features/pricing/PricingBrowser');
const { PriceHistoryModal } = await import('@/features/pricing/PriceHistoryModal');

const ROW: PriceRowView = {
  id: 7,
  priceType: '정상판매',
  major: 'WAPPLES',
  mid: 'Appliance',
  minor: 'H500',
  itemCode: 'P10100015',
  itemName: 'Wapples-500',
  unitPrice: '1100.00',
  currency: 'KRW',
  effectiveFrom: '2022-01-01',
  effectiveTo: null,
  itemStatus: '사용',
  operationStatus: '운영중',
  remark: null,
  source: 'erp',
  previousPrice: '1000.00',
  priceChangeRate: 10,
};
/** 첫 시기 행 — 칸은 '—' 지만 같은 버튼 */
const FIRST: PriceRowView = {
  ...ROW,
  id: 6,
  unitPrice: '1000.00',
  effectiveFrom: '2020-01-01',
  effectiveTo: '2022-01-01',
  previousPrice: null,
  priceChangeRate: null,
};

const SERIES = {
  itemName: 'Wapples-500',
  itemCode: 'P10100015',
  priceType: '정상판매',
  priceCategory: '일반',
  currency: 'KRW',
  customerCode: '0',
  customerName: null,
};

const historyRow = (over: Record<string, unknown>) => ({
  effectiveTo: null,
  operationStatus: '운영중',
  source: 'erp',
  batchFileName: 'sales.xlsx',
  remark: null,
  ...over,
});

const HISTORY = {
  currentId: 7,
  series: SERIES,
  rows: [
    historyRow({
      id: 9,
      effectiveFrom: '2024-01-01',
      unitPrice: '990.00',
      previousPrice: '1100.00',
      changeAmount: '-110.00',
      changeRate: -10,
      source: 'manual',
      batchFileName: null,
    }),
    historyRow({
      id: 7,
      effectiveFrom: '2022-01-01',
      effectiveTo: '2024-01-01',
      unitPrice: '1100.00',
      previousPrice: '1000.00',
      changeAmount: '100.00',
      changeRate: 10,
      remark: '22.01 인상',
    }),
    historyRow({
      id: 6,
      effectiveFrom: '2020-01-01',
      effectiveTo: '2022-01-01',
      unitPrice: '1000.00',
      previousPrice: null,
      changeAmount: null,
      changeRate: null,
      operationStatus: '미사용',
    }),
  ],
};

const DETAIL = {
  row: {
    ...ROW,
    sourceId: 2,
    productFamily: 'WAPPLES',
    spec: null,
    unit: 'EA',
    priceCategory: '일반',
    hasCorePrice: false,
    appliesToAllCustomers: false,
    isFinalSource: false,
    baseCoreCount: 0,
    unitPricePerCore: '0.00',
    customerCode: '0',
    customerNo: null,
    customerName: null,
    seriesKey: 'P10100015|정상판매|일반|KRW|0',
    batchFileName: 'sales.xlsx',
    erpMajor: null,
  },
  history: [],
};

const BROWSER = { filter: { dateMode: 'start' as const, page: 1 }, userId: 'u1' };
const LABEL = 'Wapples-500 정상판매 가격 변동 이력';

const historyDialog = () => screen.getByRole('dialog', { name: '가격 변동 이력' });
const historyTable = () =>
  within(historyDialog()).getByRole('table', { name: '가격 변동 이력 표' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail.mockResolvedValue({ ok: true, data: DETAIL });
  mocks.history.mockResolvedValue({ ok: true, data: HISTORY });
});

describe('가격 변동 칸 = 이력 모달 트리거 (§2.2)', () => {
  it('관리 표: button·aria-haspopup·라벨·describedby, 보이는 표시는 그대로', () => {
    render(<PricingBrowser mode="admin" withPriceChange rows={[ROW, FIRST]} {...BROWSER} />);
    const [up, first] = screen.getAllByRole('button', { name: LABEL });
    expect(up).toHaveAttribute('type', 'button');
    expect(up).toHaveAttribute('aria-haspopup', 'dialog');
    expect(up).toHaveAccessibleDescription('이전 대비 10.0% 상승'); // 화살표는 aria-hidden
    expect(up!.querySelector('[data-price-change="up"]')).toHaveTextContent(
      '▲이전 대비 10.0% 상승',
    );
    // '—' 칸도 같은 버튼
    expect(first!.querySelector('[data-price-change="none"]')).toHaveTextContent('—');
    expect(first).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('조회 표(/pricing): 가격 변동 헤더·칸·버튼 없음, 드로어에 계열 이력·"변동 이력 보기" 없음, 이력 요청 0', async () => {
    const { previousPrice, priceChangeRate, ...viewRow } = ROW;
    expect([previousPrice, priceChangeRate]).toEqual(['1000.00', 10]);
    mocks.detail.mockResolvedValue({ ok: true, data: { row: DETAIL.row } });
    // withPriceChange 가 와도 조회 표는 그리지 않는다(서버는 false 로 넘긴다)
    render(<PricingBrowser mode="view" withPriceChange rows={[viewRow]} {...BROWSER} />);
    expect(
      within(screen.getByRole('table')).queryByRole('button', { name: '가격 변동' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull();
    expect(document.querySelector('[data-price-change]')).toBeNull();
    await userEvent.click(screen.getByText('Wapples-500'));
    const drawer = await screen.findByRole('dialog', { name: '행 상세' });
    await within(drawer).findByRole('region', { name: '원본 20컬럼' });
    expect(mocks.detail).toHaveBeenCalledWith(7, 'view');
    expect(within(drawer).queryByRole('region', { name: '계열 이력' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: '변동 이력 보기' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '가격 변동 이력' })).toBeNull();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('클릭 → 모달(드로어 아님), 요청 1회·행 id 만', async () => {
    render(<PricingBrowser mode="admin" withPriceChange rows={[ROW]} {...BROWSER} />);
    await userEvent.click(screen.getByRole('button', { name: LABEL }));
    expect(historyDialog()).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '행 상세' })).not.toBeInTheDocument();
    expect(mocks.detail).not.toHaveBeenCalled();
    await within(historyDialog()).findByRole('table');
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenCalledWith(7);
  });

  it.each(['{Enter}', ' '])('키보드 %s → 모달, 드로어 아님', async (key) => {
    render(<PricingBrowser mode="admin" withPriceChange rows={[ROW]} {...BROWSER} />);
    screen.getByRole('button', { name: LABEL }).focus();
    await userEvent.keyboard(key);
    expect(historyDialog()).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '행 상세' })).not.toBeInTheDocument();
  });

  it('같은 행의 다른 칸 클릭은 기존처럼 드로어', async () => {
    render(<PricingBrowser mode="admin" withPriceChange rows={[ROW]} {...BROWSER} />);
    await userEvent.click(screen.getByText('Wapples-500'));
    expect(await screen.findByRole('dialog', { name: '행 상세' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '가격 변동 이력' })).not.toBeInTheDocument();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('열 리사이즈 드래그가 칸 위에서 끝난 직후의 click 은 모달·드로어를 열지 않는다', async () => {
    render(<PricingBrowser mode="admin" withPriceChange rows={[ROW]} {...BROWSER} />);
    const handle = screen.getByRole('separator', { name: '가격 변동 열 너비 조절' });
    const button = screen.getByRole('button', { name: LABEL });
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerType: 'mouse' });
    fireEvent.pointerMove(document, { clientX: 160 });
    fireEvent.pointerUp(button, { clientX: 160 });
    fireEvent.click(button);
    expect(screen.queryByRole('dialog', { name: '가격 변동 이력' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '행 상세' })).not.toBeInTheDocument();
    // 억제는 다음 태스크에서 풀린다 — 이후 클릭은 정상
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await userEvent.click(button);
    expect(historyDialog()).toBeInTheDocument();
  });

  it('열 재배치 드래그 뒤 칸 위 click 도 무시', async () => {
    render(<PricingBrowser mode="admin" withPriceChange rows={[ROW]} {...BROWSER} />);
    const header = within(screen.getByRole('table')).getByRole('button', { name: '가격 변동' });
    const button = screen.getByRole('button', { name: LABEL });
    fireEvent.pointerDown(header, { button: 0, clientX: 100, clientY: 10, pointerType: 'mouse' });
    fireEvent.pointerMove(document, { clientX: 140, clientY: 60 });
    fireEvent.pointerUp(button, { clientX: 140, clientY: 60 });
    fireEvent.click(button);
    expect(screen.queryByRole('dialog', { name: '가격 변동 이력' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '행 상세' })).not.toBeInTheDocument();
  });
});

describe('PriceHistoryModal 내용·상태 (§2.3)', () => {
  it('요약 6항목(거래처 0 → 전체 고객), 표 최신 순, 금액 부호·통화, 첫 행 —, 출처, 클릭 행 aria-current', async () => {
    render(<PriceHistoryModal rowId={7} onClose={vi.fn()} />);
    const table = await within(historyDialog()).findByRole('table', { name: '가격 변동 이력 표' });
    const dl = within(historyDialog()).getByLabelText('계열 요약');
    const terms = within(dl)
      .getAllByRole('term')
      .map((dt) => dt.textContent);
    const defs = within(dl)
      .getAllByRole('definition')
      .map((dd) => dd.textContent);
    expect(terms).toEqual(['품명', '품번', '단가유형', '단가구분', '화폐', '거래처']);
    expect(defs).toEqual(['Wapples-500', 'P10100015', '정상판매', '일반', 'KRW', '전체 고객']);

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['적용기간', '판매가', '직전 대비 금액', '변동률', '운영상태', '출처', '비고']);
    const body = table.querySelectorAll('tbody tr');
    expect([...body].map((tr) => tr.getAttribute('data-row-id'))).toEqual(['9', '7', '6']);
    const cells = (i: number) => [...body[i]!.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells(0)).toEqual([
      '2024-01-01 ~ 현재',
      '990원',
      '-110원',
      '▼이전 대비 10.0% 하락',
      '운영중',
      '수동 등록',
      '', // 비고 없음 = 가격 표처럼 빈 칸
    ]);
    expect(cells(1)).toEqual([
      '2022-01-01 ~ 2023-12-31',
      '1,100원',
      '+100원',
      '▲이전 대비 10.0% 상승',
      '운영중',
      'ERP 임포트 (sales.xlsx)',
      '22.01 인상',
    ]);
    expect(cells(2)).toEqual([
      '2020-01-01 ~ 2021-12-31',
      '1,000원',
      '—',
      '—',
      '미사용',
      'ERP 임포트 (sales.xlsx)',
      '',
    ]);
    expect(body[1]).toHaveAttribute('aria-current', 'true');
    expect(body[1]!.className).toContain('aria-[current]:bg-lime-500/25');
    expect(body[0]).not.toHaveAttribute('aria-current');
    // 원가 비중·변경자 없음, 1행 안내 없음
    expect(historyDialog()).not.toHaveTextContent(/원가|변경자/);
    expect(screen.queryByText('이 계열의 첫 가격입니다. 이전 변동 이력이 없습니다.')).toBeNull();
    // 표 가로 스크롤은 표 래퍼 안에서만
    expect(table.parentElement!.className).toContain('overflow-x-auto');
  });

  it('USER 응답(요약에 erpRemark 키 없음): 요약 6항목, 비고 열은 행별 비고', async () => {
    render(<PriceHistoryModal rowId={7} onClose={vi.fn()} />);
    const table = await within(historyDialog()).findByRole('table');
    const dl = within(historyDialog()).getByLabelText('계열 요약');
    expect(within(dl).queryByText('ERP 비고(품목)')).toBeNull();
    expect(within(dl).getAllByRole('term')).toHaveLength(6);
    expect(within(table).getByRole('columnheader', { name: '비고' })).toBeInTheDocument();
    expect(within(table).getByText('22.01 인상')).toBeInTheDocument();
  });

  it('ADMIN 응답: 품목 마스터 비고는 요약에 한 번, 표 비고 열은 행별 비고 그대로', async () => {
    mocks.history.mockResolvedValue({
      ok: true,
      data: { ...HISTORY, series: { ...SERIES, erpRemark: '담당 메모' } },
    });
    render(<PriceHistoryModal rowId={7} onClose={vi.fn()} />);
    const table = await within(historyDialog()).findByRole('table');
    const dl = within(historyDialog()).getByLabelText('계열 요약');
    expect(within(dl).getByText('ERP 비고(품목)')).toBeInTheDocument();
    expect(within(historyDialog()).getAllByText('담당 메모')).toHaveLength(1);
    expect(within(table).queryByText('담당 메모')).toBeNull();
    expect(within(table).getByText('22.01 인상')).toBeInTheDocument();
  });

  it('ADMIN 이어도 품목 마스터 비고가 비어 있으면 요약 행을 숨긴다', async () => {
    mocks.history.mockResolvedValue({
      ok: true,
      data: { ...HISTORY, series: { ...SERIES, erpRemark: '  ' } },
    });
    render(<PriceHistoryModal rowId={7} onClose={vi.fn()} />);
    await within(historyDialog()).findByRole('table');
    expect(within(historyDialog()).queryByText('ERP 비고(품목)')).toBeNull();
  });

  it('로딩 → 1행 계열 안내', async () => {
    const pending = deferred<unknown>();
    mocks.history.mockReturnValue(pending.promise);
    render(<PriceHistoryModal rowId={6} onClose={vi.fn()} />);
    expect(within(historyDialog()).getByText('불러오는 중…')).toBeInTheDocument();
    await act(async () =>
      pending.resolve({
        ok: true,
        data: {
          currentId: 6,
          series: { ...SERIES, customerCode: 'C01', customerName: '고객사' },
          rows: [HISTORY.rows[2]],
        },
      }),
    );
    expect(
      within(historyDialog()).getByText('이 계열의 첫 가격입니다. 이전 변동 이력이 없습니다.'),
    ).toBeInTheDocument();
    expect(within(historyDialog()).getByText('C01 (고객사)')).toBeInTheDocument();
  });

  it('NOT_FOUND 안내', async () => {
    mocks.history.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: '삭제되었거나 찾을 수 없는 가격입니다.' },
    });
    render(<PriceHistoryModal rowId={7} onClose={vi.fn()} />);
    expect(
      await within(historyDialog()).findByText('삭제되었거나 찾을 수 없는 가격입니다.'),
    ).toBeInTheDocument();
    expect(within(historyDialog()).queryByRole('alert')).toBeNull();
    expect(within(historyDialog()).queryByRole('button', { name: '다시 시도' })).toBeNull();
  });

  it('오류 → role=alert + [다시 시도] → 재요청 성공', async () => {
    mocks.history.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INTERNAL', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요' },
    });
    render(<PriceHistoryModal rowId={7} onClose={vi.fn()} />);
    const alert = await within(historyDialog()).findByRole('alert');
    expect(alert).toHaveTextContent('요청을 처리하지 못했습니다');
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    expect(await within(historyDialog()).findByRole('table')).toBeInTheDocument();
    expect(mocks.history).toHaveBeenCalledTimes(2);
  });

  it('겹친 요청: 늦게 온 이전 응답은 무시한다', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.history
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: '실패' } })
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { rerender } = render(<PriceHistoryModal rowId={7} onClose={vi.fn()} />);
    const alert = await within(historyDialog()).findByRole('alert');
    await userEvent.click(within(alert).getByRole('button', { name: '다시 시도' }));
    // 같은 모달이 다른 행으로 바뀌면(드문 경우) 이전 요청 응답은 버린다
    rerender(<PriceHistoryModal rowId={9} onClose={vi.fn()} />);
    await act(async () => second.resolve({ ok: true, data: { ...HISTORY, currentId: 9 } }));
    await act(async () =>
      first.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'stale' } }),
    );
    expect(historyTable().querySelector('tr[aria-current="true"]')).toHaveAttribute(
      'data-row-id',
      '9',
    );
    expect(screen.queryByText('삭제되었거나 찾을 수 없는 가격입니다.')).toBeNull();
  });
});

describe('닫기·포커스 (§2.3-6)', () => {
  it.each([
    ['Esc', (dialog: HTMLElement) => fireEvent(dialog, new Event('cancel', { cancelable: true }))],
    [
      '닫기 버튼',
      (dialog: HTMLElement) =>
        fireEvent.click(within(dialog).getByRole('button', { name: '닫기' })),
    ],
    ['백드롭', (dialog: HTMLElement) => fireEvent.click(dialog)],
  ])('%s → 닫힘, 포커스는 클릭한 칸 버튼', async (_name, close) => {
    render(<PricingBrowser mode="admin" withPriceChange rows={[ROW]} {...BROWSER} />);
    const button = screen.getByRole('button', { name: LABEL });
    await userEvent.click(button);
    const dialog = historyDialog();
    await within(dialog).findByRole('table');
    close(dialog);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '가격 변동 이력' })).not.toBeInTheDocument(),
    );
    expect(button).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: '행 상세' })).not.toBeInTheDocument();
  });
});

describe('드로어 "변동 이력 보기" (§2.4 Q-H1 = B)', () => {
  it('드로어 행 id 로 같은 모달(행 강조), Esc 는 모달만 닫고 드로어 유지·포커스 버튼 복귀', async () => {
    render(<PricingBrowser mode="admin" withPriceChange rows={[ROW]} {...BROWSER} />);
    await userEvent.click(screen.getByText('Wapples-500'));
    const drawer = await screen.findByRole('dialog', { name: '행 상세' });
    const region = within(drawer).getByRole('region', { name: '계열 이력' });
    const open = within(region).getByRole('button', { name: '변동 이력 보기' });
    expect(open).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(open);
    const dialog = historyDialog();
    expect(mocks.history).toHaveBeenCalledWith(7);
    await within(dialog).findByRole('table');
    expect(historyTable().querySelector('tr[aria-current="true"]')).toHaveAttribute(
      'data-row-id',
      '7',
    );
    // 모달은 드로어 DOM 밖 — Esc keydown 이 드로어 패널의 Esc 처리로 번지지 않는다
    expect(drawer.contains(dialog)).toBe(false);
    fireEvent.keyDown(within(dialog).getByRole('button', { name: '닫기' }), { key: 'Escape' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '가격 변동 이력' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: '행 상세' })).toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it('닫기 버튼으로 닫아도 드로어 유지', async () => {
    render(<PricingBrowser mode="admin" withPriceChange rows={[ROW]} {...BROWSER} />);
    await userEvent.click(screen.getByText('Wapples-500'));
    const drawer = await screen.findByRole('dialog', { name: '행 상세' });
    await userEvent.click(within(drawer).getByRole('button', { name: '변동 이력 보기' }));
    fireEvent.click(within(historyDialog()).getByRole('button', { name: '닫기' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '가격 변동 이력' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: '행 상세' })).toBeInTheDocument();
  });
});

describe('Modal size (§2.3-1)', () => {
  it("기본(md) = 520px 그대로, size='lg' = 760px", () => {
    const { rerender } = render(
      <Modal open onClose={vi.fn()} title="기본">
        본문
      </Modal>,
    );
    const md = screen.getByRole('dialog', { name: '기본' });
    expect(md.className).toContain('w-[min(520px,calc(100vw-32px))]');
    expect(md.className).not.toContain('760px');
    rerender(
      <Modal open onClose={vi.fn()} title="기본" size="lg">
        본문
      </Modal>,
    );
    const lg = screen.getByRole('dialog', { name: '기본' });
    expect(lg.className).toContain('w-[min(760px,calc(100vw-32px))]');
    expect(lg.className).not.toContain('520px');
  });
});
