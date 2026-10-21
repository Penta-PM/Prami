import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** /admin/costs 페이지 — 토큰 가드(requireCostPageAccess) 호출과 렌더 구성을 확인. 쿼리·권한은 모킹 */
const calls = vi.hoisted(() => ({ guards: [] as string[], filters: [] as unknown[] }));

vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/cost/access', () => ({
  requireCostPageAccess: async (path: string) => {
    calls.guards.push(path);
    return { userId: 'u1', email: 'admin@pentasecurity.com', scope: 'read' };
  },
}));
vi.mock('@/server/cost/queries', () => ({
  getCostRows: async (_access: unknown, _db: unknown, filter: unknown) => {
    calls.filters.push(filter);
    return {
      rows: [
        {
          id: 1,
          materialCode: 'W40100002',
          materialName: 'iSIGN+ 100',
          unit: 'EA',
          unitCost: '310000.00',
          currency: 'KRW',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          operationStatus: '운영중',
          productFamily: 'iSIGN',
          remark: null,
          source: 'erp',
        },
      ],
      total: 108,
      page: 2,
      pageCount: 3,
    };
  },
  listCostFamilies: async () => [{ family: 'iSIGN', count: 108 }],
  listCostYears: async () => [2026, 2025],
  listCostCurrencies: async () => ['KRW', 'USD'],
  getCurrentCostApply: async () => ({
    batchId: 'b1',
    fileName: '원자재코드 정보_260825.xlsx',
    appliedAt: '2026-09-28T03:00:00.000Z',
  }),
}));
vi.mock('@/server/imports/queries', () => ({ listReusableBatches: async () => [] }));
vi.mock('@/server/auth/rbac', () => ({
  getSessionUser: async () => ({ id: 'u1', email: 'admin@pentasecurity.com', role: 'ADMIN' }),
}));
vi.mock('@/features/costs/actions', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/costs',
}));

// 조회 상태 복원·저장(page-state-memory B-1)은 tests/unit/page-state 에서 검증한다 — 여기서는 화면 렌더만
vi.mock('@/server/page-state/restore-page', () => ({
  restoreViewState: async (pageKey: string) => ({ pageKey, savedQuery: null, restoreTop: null }),
}));
vi.mock('@/features/page-state/ViewStateTracker', () => ({ ViewStateTracker: () => null }));

const { default: AdminCostsPage } = await import('@/app/(app)/admin/costs/page');

describe('/admin/costs', () => {
  it('cost.read 페이지 가드 → 제목·현재 적용·안내·적용 패널·필터·표·페이지', async () => {
    render(
      await AdminCostsPage({
        searchParams: Promise.resolve({ family: 'iSIGN', dateMode: 'period', page: '2' }),
      }),
    );
    expect(calls.guards).toEqual(['/admin/costs']);
    expect(calls.filters.at(-1)).toMatchObject({ family: 'iSIGN', dateMode: 'period', page: 2 });
    expect(screen.getByRole('heading', { level: 1, name: '원가 관리' })).toBeInTheDocument();
    expect(screen.getByLabelText('현재 적용')).toHaveTextContent('원자재코드 정보_260825.xlsx');
    expect(screen.getByText(/관리자에게만 노출됩니다/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '원가 파일 적용' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /iSIGN/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('table', { name: '원가 표' })).toHaveTextContent('310,000원');
    expect(screen.getByText('총 108건 · 2 / 3 페이지')).toBeInTheDocument();
  });
});
