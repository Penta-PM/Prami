import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isValidElement, type ReactNode } from 'react';
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
  // 원가 매핑 칸(policy-cost-link-column §2.2) — 원가 비중과 같은 로더가 함께 돌려준다
  links: {} as Record<string, unknown>,
  canEditLinks: true,
  loaderRows: [] as unknown[],
  // 가격 행 조회(본 기능) 실패 주입
  priceRowsError: null as Error | null,
  // getPriceRows 세 번째 인자 (가격 변동 노출 — pricing-view-hide-price-change §1)
  rowOptions: [] as unknown[],
  // 세션 사용자 역할 (가격 변동 노출 판정: 관리 화면 + pricing.write)
  role: 'ADMIN' as 'ADMIN' | 'USER',
}));

vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/pricing/categories', () => ({
  getCategoryOptions: async () => ({ majors: ['WAPPLES'], mids: [], minors: [], hasMaster: false }),
}));
vi.mock('@/server/pricing/queries', () => ({
  listEffectiveYears: async () => [2026, 2025],
  listPriceCurrencies: async () => ['KRW', 'USD'],
  listPriceTypes: async () => ['정상판매', '__none__'],
  getPriceRows: async (
    _db: unknown,
    filter: unknown,
    options: { withPriceChange?: boolean } = {},
  ) => {
    if (calls.priceRowsError) throw calls.priceRowsError;
    calls.filters.push(filter);
    calls.rowOptions.push(options);
    // 실제 쿼리처럼: withPriceChange 일 때만 가격 변동 키
    const change = options.withPriceChange ? { previousPrice: null, priceChangeRate: null } : {};
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
          ...change,
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
  getSessionUser: async () => ({ id: 'u1', email: 'x@pentasecurity.com', role: calls.role }),
}));
vi.mock('@/features/pricing/actions', () => ({}));
vi.mock('@/features/costs/link-actions', () => ({}));
vi.mock('@/features/costs/price-ratios', () => ({
  loadPolicyCostColumns: async (rows: { id: number; itemCode: string }[]) => {
    calls.ratioIds.push(rows.map((row) => row.id));
    calls.loaderRows.push(rows);
    return calls.ratios
      ? {
          ratios: calls.ratios,
          links: calls.links,
          canEditLinks: calls.canEditLinks,
          failed: calls.ratioFailed,
        }
      : null;
  },
}));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/pricing',
}));

// 조회 상태 복원·저장(page-state-memory B-1)은 tests/unit/page-state 에서 검증한다 — 여기서는 화면 렌더만
vi.mock('@/server/page-state/restore-page', () => ({
  restoreViewState: async (pageKey: string) => ({ pageKey, savedQuery: null, restoreTop: null }),
}));
vi.mock('@/features/page-state/ViewStateTracker', () => ({ ViewStateTracker: () => null }));

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
    // 빠른 필터 바: 조건이 걸린 필드 버튼에 값 (통화는 ＋ 더 필드지만 조건이 걸려 바에 보인다)
    expect(
      [...document.querySelectorAll('[data-quick-field]')]
        .filter((button) => button.getAttribute('aria-label')?.endsWith('적용 중'))
        .map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining('통화: USD'),
      expect.stringContaining('판매가: USD ≥ 100'),
      expect.stringContaining('상태: 운영중'),
    ]);
    // 페이지 필터(분류·기간·검색)는 바와 같은 카드(필터 그룹) 안
    expect(
      within(screen.getByRole('group', { name: '필터' })).getByRole('search', {
        name: '가격정책 검색',
      }),
    ).toBeInTheDocument();
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
    // 판매가 → 원가 매핑 → 원가 비중 (policy-cost-link-column §2.1-1)
    expect(headers.indexOf('원가 비중')).toBe(headers.indexOf('판매가') + 2);
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

/** 서버 컴포넌트가 클라이언트(PricingBrowser 등)로 넘기는 props 전체 — RSC payload 에 실리는 값 */
function clientProps(node: ReactNode): unknown[] {
  if (Array.isArray(node)) return node.flatMap(clientProps);
  if (!isValidElement(node)) return [];
  const { children, ...props } = node.props as { children?: ReactNode };
  return [props, ...clientProps(children)];
}

describe('가격 변동 노출 = 관리 화면 + pricing.write (pricing-view-hide-price-change §1·§2)', () => {
  const PARAMS = { 'f.priceChange.gte': '1', sort: 'priceChange', dir: 'desc' };
  const section = (mode: 'admin' | 'view') =>
    PricingSection({
      mode,
      basePath: mode === 'admin' ? '/admin/policies' : '/pricing',
      userId: 'u1',
      searchParams: PARAMS,
    });

  it('조회(/pricing, ADMIN 이어도): 쿼리에 withPriceChange false, 가격 변동 필터·정렬 URL 은 무시(오류 없음), payload 에 키 0', async () => {
    calls.role = 'ADMIN';
    const element = await section('view');
    expect(calls.rowOptions.at(-1)).toEqual({ withPriceChange: false });
    const filter = calls.filters.at(-1) as Record<string, unknown>;
    expect(filter.filters).toBeUndefined();
    expect(filter.sort).toBeUndefined();
    const payload = JSON.stringify(clientProps(element));
    expect(payload).not.toMatch(/previousPrice|priceChange/);
    render(element);
    expect(screen.queryByRole('columnheader', { name: /가격 변동/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('관리 + pricing.write(ADMIN): withPriceChange true, 가격 변동 필터·정렬 적용, 열 있음', async () => {
    calls.role = 'ADMIN';
    render(await section('admin'));
    expect(calls.rowOptions.at(-1)).toEqual({ withPriceChange: true });
    expect(calls.filters.at(-1)).toMatchObject({
      filters: [{ col: 'priceChange', op: 'gte', value: '1' }],
      sort: { id: 'priceChange', dir: 'desc' },
    });
    expect(screen.getByRole('columnheader', { name: /가격 변동/ })).toBeInTheDocument();
  });

  it('관리 모드라도 pricing.write 가 없으면(USER) 가격 변동 없음 — 서버 판정', async () => {
    calls.role = 'USER';
    const element = await section('admin');
    expect(calls.rowOptions.at(-1)).toEqual({ withPriceChange: false });
    expect(JSON.stringify(clientProps(element))).not.toMatch(/previousPrice|priceChange/);
    calls.role = 'ADMIN';
  });
});

describe('원가 매핑 열 노출 = 관리 화면 + pricing.write + cost.read (policy-cost-link-column §2.1-2)', () => {
  const PARAMS = { sort: 'costLink', dir: 'asc', 'f.costLink.in': 'W1', 'f.costLink.has': 'x' };
  const section = (mode: 'admin' | 'view') =>
    PricingSection({
      mode,
      basePath: mode === 'admin' ? '/admin/policies' : '/pricing',
      userId: 'u1',
      searchParams: PARAMS,
    });
  const LINKS = {
    P1: { inScope: true, link: { materialCode: 'W1', materialName: '자재 1', inCostTable: true } },
  };

  it('ADMIN(+cost.read): 현재 페이지 행 id·품목코드로 로더 1회, 판매가 → 원가 매핑 → 원가 비중, payload 에 costLinks', async () => {
    calls.role = 'ADMIN';
    calls.loaderRows = [];
    calls.ratios = {};
    calls.links = LINKS;
    const element = await section('admin');
    expect(calls.loaderRows).toEqual([[{ id: 1, itemCode: 'P1' }]]);
    const payload = JSON.stringify(clientProps(element));
    expect(payload).toContain('"costLinks"');
    expect(payload).toContain('"costLinkEditable":true');
    // 원가 금액 키 없음
    expect(payload).not.toMatch(/unit_?cost|unitCost/i);
    // sort=costLink·f.costLink.* 는 화이트리스트 밖 — 무시(기본 정렬, 오류 없음)
    const filter = calls.filters.at(-1) as Record<string, unknown>;
    expect(filter.sort).toBeUndefined();
    expect(filter.filters).toBeUndefined();
    render(element);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(headers.indexOf('원가 매핑')).toBe(headers.indexOf('판매가') + 1);
    expect(headers.indexOf('원가 비중')).toBe(headers.indexOf('원가 매핑') + 1);
    // 정렬 아이콘·aria-sort 없음
    const header = screen.getByRole('columnheader', { name: /원가 매핑/ });
    expect(header).not.toHaveAttribute('aria-sort');
    expect(header.querySelector('svg')).toBeNull();
    expect(screen.getByRole('button', { name: '모델 1 원가 매핑 수정' })).toHaveTextContent('W1');
    expect(screen.queryByRole('alert')).toBeNull();
    calls.links = {};
  });

  it('cost.write 없음: 칸은 텍스트만(버튼 없음)', async () => {
    calls.role = 'ADMIN';
    calls.ratios = {};
    calls.links = LINKS;
    calls.canEditLinks = false;
    render(await section('admin'));
    expect(screen.getByRole('columnheader', { name: /원가 매핑/ })).toBeInTheDocument();
    expect(screen.getByText('W1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /원가 매핑 수정/ })).toBeNull();
    calls.canEditLinks = true;
    calls.links = {};
  });

  it('cost.read 없음(로더 null): 헤더·payload 키 0', async () => {
    calls.role = 'ADMIN';
    calls.ratios = null;
    const element = await section('admin');
    expect(JSON.stringify(clientProps(element))).not.toMatch(/costLink|costRatio/);
    render(element);
    expect(screen.queryByRole('columnheader', { name: /원가 매핑/ })).toBeNull();
  });

  it.each([
    ['관리 + pricing.write 없음(USER)', 'admin', 'USER'],
    ['조회(/pricing, ADMIN 이어도)', 'view', 'ADMIN'],
  ] as const)('%s: 로더를 부르지 않고 헤더·payload 키 0', async (_name, mode, role) => {
    calls.role = role;
    calls.loaderRows = [];
    calls.ratios = {};
    calls.links = LINKS;
    const element = await section(mode);
    expect(calls.loaderRows).toEqual([]);
    expect(JSON.stringify(clientProps(element))).not.toMatch(/costLink|costRatio|materialCode/);
    render(element);
    expect(screen.queryByRole('columnheader', { name: /원가 매핑/ })).toBeNull();
    calls.role = 'ADMIN';
    calls.links = {};
  });
});
