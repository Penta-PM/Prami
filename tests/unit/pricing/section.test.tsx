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
}));

vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/pricing/categories', () => ({
  getCategoryOptions: async () => ({ majors: ['WAPPLES'], mids: [], minors: [], hasMaster: false }),
}));
vi.mock('@/server/pricing/queries', () => ({
  listEffectiveYears: async () => [2026, 2025],
  getPriceRows: async (_db: unknown, filter: unknown) => {
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
    return calls.ratios;
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
