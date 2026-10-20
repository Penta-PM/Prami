import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/** 조회·관리 공용 서버 섹션 + /pricing 페이지 가드 — 쿼리·권한은 모킹 */
const calls = vi.hoisted(() => ({
  filters: [] as unknown[],
  guards: [] as string[],
  ratioIds: [] as number[][],
  // null = cost.read 없음(열 없음), 객체 = 원가 비중
  ratios: null as Record<number, unknown> | null,
  // 원가 비중 계산 실패(migration-apply-lan §2-3)
  ratioFailed: false,
  // 가격 행 조회(본 기능) 실패 주입
  priceRowsError: null as Error | null,
}));

vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/pricing/categories', () => ({
  getCategoryOptions: async () => ({ majors: ['WAPPLES'], mids: [], minors: [], hasMaster: false }),
}));
vi.mock('@/server/pricing/queries', () => ({
  listEffectiveYears: async () => [2026, 2025],
  listPriceCurrencies: async () => ['KRW', 'USD'],
  listPriceTypes: async () => ['정상판매', '__none__'],
  getPriceRows: async (_db: unknown, filter: unknown) => {
    if (calls.priceRowsError) throw calls.priceRowsError;
    calls.filters.push(filter);
    return {
      rows: [
        {
          id: 1,
          priceType: null,
          major: 'WAPPLES',
          mid: null,
          minor: null,
          itemCode: 'P1',
          itemName: '모델 1',
          unitPrice: '126.00',
          currency: 'USD',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          itemStatus: '미확인',
          operationStatus: '운영중',
          remark: null,
          source: 'erp',
          previousPrice: null,
          priceChangeRate: null,
        },
      ],
      total: 51,
      page: 2,
      pageCount: 2,
    };
  },
}));
vi.mock('@/server/auth/rbac', () => ({
  requirePagePermission: async (permission: string, path: string) => {
    calls.guards.push(`${permission}:${path}`);
    return { id: 'u1', email: 'admin@pentasecurity.com', role: 'ADMIN' };
  },
}));
vi.mock('@/features/pricing/actions', () => ({}));
vi.mock('@/features/costs/price-ratios', () => ({
  loadPolicyCostRatios: async (ids: number[]) => {
    calls.ratioIds.push(ids);
    return calls.ratios ? { ratios: calls.ratios, failed: calls.ratioFailed } : null;
  },
}));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/pricing',
}));

const { PricingSection } = await import('@/features/pricing/PricingSection');

describe('PricingSection', () => {
  it('URL 필터를 파싱해 쿼리에 넘기고, 필터·표·페이지(총건수)를 렌더한다', async () => {
    render(
      await PricingSection({
        mode: 'admin',
        basePath: '/admin/policies',
        userId: 'u1',
        searchParams: { dateMode: 'period', from: '2025-01-01', to: '2025-12-31', page: '2' },
      }),
    );
    expect(calls.filters.at(-1)).toMatchObject({ dateMode: 'period', from: '2025-01-01', page: 2 });
    expect(screen.getByRole('table', { name: '가격정책 관리 표' })).toBeInTheDocument();
    expect(screen.getByText('126 USD')).toBeInTheDocument();
    expect(screen.getByText('총 51건 · 2 / 2 페이지')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '이전' })).toHaveAttribute(
      'href',
      '/admin/policies?dateMode=period&from=2025-01-01&to=2025-12-31',
    );
    expect(screen.getByPlaceholderText('모델명, 코드로 검색')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026' })).toBeInTheDocument();
  });

  it('열 필터: 화이트리스트(데이터 통화 포함)만 파싱해 쿼리에 넘기고, 페이지 링크·칩이 유지한다 (표 열 필터 §2.3)', async () => {
    render(
      await PricingSection({
        mode: 'admin',
        basePath: '/admin/policies',
        userId: 'u1',
        searchParams: {
          q: 'abc',
          'f.status.in': '운영중',
          'f.currency.in': 'USD',
          'f.price.gte': '100',
          // 원가 비중·분류·품목명은 열 필터 없음, 데이터에 없는 통화·모르는 연산자는 무시
          'f.costRatio.gte': '1',
          'f.major.has': 'W',
          'f.itemName.has': 'x',
          'f.remark.like': 'x',
          'f.priceType.in': '정상판매,할인',
          page: '2',
        },
      }),
    );
    expect(calls.filters.at(-1)).toMatchObject({
      q: 'abc',
      filters: [
        { col: 'currency', op: 'in', values: ['USD'] },
        { col: 'price', op: 'gte', value: '100' },
        { col: 'status', op: 'in', values: ['운영중'] },
      ],
    });
    expect(screen.getByRole('link', { name: '이전' })).toHaveAttribute(
      'href',
      `/admin/policies?q=abc&${new URLSearchParams([
        ['f.currency.in', 'USD'],
        ['f.price.gte', '100'],
        ['f.status.in', '운영중'],
      ])}`,
    );
    const chips = screen.getByRole('list', { name: '적용된 필터' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('통화: USD'),
      expect.stringContaining('판매가: ≥ 100'),
      expect.stringContaining('상태: 운영중'),
    ]);
    expect(screen.getByRole('button', { name: '필터 초기화' })).toBeInTheDocument();
  });
});

describe('원가 비중 열 (cost-ratio-price-change §2.3)', () => {
  const render2 = async (mode: 'admin' | 'view') =>
    render(
      await PricingSection({
        mode,
        basePath: mode === 'admin' ? '/admin/policies' : '/pricing',
        userId: 'u1',
        searchParams: {},
      }),
    );

  it('관리 표 + cost.read: 현재 페이지 행 id 로 계산을 부르고, 판매가 바로 뒤 "원가 비중" 헤더·NN.N%·원가 적용일 툴팁', async () => {
    calls.ratioIds = [];
    calls.ratios = { 1: { costRatio: 30, costFrom: '2026-05-01' } };
    await render2('admin');
    expect(calls.ratioIds).toEqual([[1]]);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(headers.indexOf('원가 비중')).toBe(headers.indexOf('판매가') + 1);
    // 1차 정렬 불가: 헤더(이동용 버튼만 있음)를 눌러도 정렬되지 않고 aria-sort·정렬 아이콘이 없다
    const header = screen.getByRole('columnheader', { name: /원가 비중/ });
    await userEvent.click(within(header).getByRole('button'));
    expect(header).not.toHaveAttribute('aria-sort');
    expect(header.querySelector('svg')).toBeNull();
    expect(push).not.toHaveBeenCalled();
    const cell = screen.getByText('30.0%');
    expect(cell.closest('[title]')).toHaveAttribute('title', '원가 적용일 2026-05-01');
  });

  it('관리 표 + cost.read 없음: 열 정의·헤더 없음', async () => {
    calls.ratioIds = [];
    calls.ratios = null;
    await render2('admin');
    expect(calls.ratioIds).toEqual([[1]]);
    expect(screen.queryByRole('columnheader', { name: /원가 비중/ })).toBeNull();
  });

  it('계산 실패(cost_item_links 미적용 등): 화면은 렌더, 원가 비중 칸 "—" + 표 위 관리자 안내(migration-apply-lan §2-3)', async () => {
    calls.ratioIds = [];
    calls.ratios = {};
    calls.ratioFailed = true;
    await render2('admin');
    calls.ratioFailed = false;
    expect(screen.getByRole('table', { name: '가격정책 관리 표' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /원가 비중/ })).toBeInTheDocument();
    expect(
      screen.getByText('원가 비중을 계산하지 못했습니다. 관리자에게 문의하세요.'),
    ).toHaveAttribute('role', 'status');
    expect(screen.queryByText('30.0%')).toBeNull();
  });

  it('원가 권한 없음(null)·정상 계산이면 안내 없음', async () => {
    calls.ratios = null;
    const { unmount } = await render2('admin');
    expect(screen.queryByText(/원가 비중을 계산하지 못했습니다/)).toBeNull();
    unmount();
    calls.ratios = { 1: { costRatio: 30, costFrom: '2026-05-01' } };
    await render2('admin');
    expect(screen.queryByText(/원가 비중을 계산하지 못했습니다/)).toBeNull();
  });

  it('가격 행 조회(본 기능) 실패는 삼키지 않는다 — 기존 오류 화면(오류 전파)', async () => {
    calls.priceRowsError = new Error('relation "sales_prices" does not exist');
    await expect(
      PricingSection({
        mode: 'admin',
        basePath: '/admin/policies',
        userId: 'u1',
        searchParams: {},
      }),
    ).rejects.toThrow(/sales_prices/);
    calls.priceRowsError = null;
  });

  it('조회 표(/pricing): 원가 비중 계산을 부르지 않고 열도 없다', async () => {
    calls.ratioIds = [];
    calls.ratios = { 1: { costRatio: 30, costFrom: '2026-05-01' } };
    await render2('view');
    expect(calls.ratioIds).toEqual([]);
    expect(screen.queryByRole('columnheader', { name: /원가 비중/ })).toBeNull();
    expect(screen.queryByText('30.0%')).toBeNull();
  });
});

describe('/pricing', () => {
  it('pricing.read 를 검사하고 "가격 정책 조회" 제목 + 조회 모드 섹션', async () => {
    vi.resetModules();
    vi.doMock('@/features/pricing/PricingSection', () => ({
      PricingSection: ({ mode }: { mode: string }) => (
        <div data-testid="section" data-mode={mode} />
      ),
    }));
    const { default: PricingPage } = await import('@/app/(app)/pricing/page');
    render(await PricingPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId('section')).toHaveAttribute('data-mode', 'view');
    expect(calls.guards).toContain('pricing.read:/pricing');
    expect(screen.getByRole('heading', { level: 1, name: '가격 정책 조회' })).toBeInTheDocument();
  });
});
