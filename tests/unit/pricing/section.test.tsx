import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** 조회·관리 공용 서버 섹션 + /pricing 페이지 가드 — 쿼리·권한은 모킹 */
const calls = vi.hoisted(() => ({ filters: [] as unknown[], guards: [] as string[] }));

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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
