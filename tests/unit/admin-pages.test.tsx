import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** 관리자 페이지 조립 (서버 컴포넌트) — 권한 가드·쿼리는 모킹 */
const calls = vi.hoisted(() => ({ guards: [] as string[] }));

vi.mock('@/server/auth/rbac', () => ({
  requirePagePermission: async (permission: string, path: string) => {
    calls.guards.push(`${permission}:${path}`);
    return { id: 'a', email: 'admin@pentasecurity.com', role: 'ADMIN' };
  },
  requireAdminArea: async () => {
    calls.guards.push('admin-area');
  },
}));
vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/users/queries', () => ({
  listUsers: async () => [
    {
      id: 'a',
      email: 'admin@pentasecurity.com',
      name: '관리자',
      department: null,
      role: 'ADMIN',
      status: 'active',
      createdVia: 'bootstrap',
      lastLoginAt: new Date('2026-09-23T00:00:00Z'),
    },
  ],
}));
vi.mock('@/server/audit/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/audit/queries')>()),
  getAuditLogs: async () => ({ rows: [], total: 0, page: 1, pageSize: 50, pageCount: 1 }),
  listAuditActions: async () => ['auth.login'],
}));
vi.mock('@/features/users/actions', () => ({}));
vi.mock('@/features/admin-policies/actions', () => ({ applyPolicyAction: vi.fn() }));
vi.mock('@/server/imports/queries', () => ({
  getCurrentApply: async () => ({
    runId: 'r1',
    finishedAt: '2026-09-23T00:00:00.000Z',
    stats: null,
    sales: { id: 's1', fileName: '병합_가격_raw.xlsx' },
    item: null,
  }),
  listReusableBatches: async () => [],
  listRecentRuns: async () => [
    { id: 'r2', status: 'failed', startedAt: '2026-09-23T01:00:00.000Z', error: '불변식 I-1 위반' },
  ],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { default: AdminLayout } = await import('@/app/(app)/admin/layout');
const { default: AdminUsersPage } = await import('@/app/(app)/admin/users/page');
const { default: AdminAuditPage } = await import('@/app/(app)/admin/audit/page');
const { default: AdminPoliciesPage } = await import('@/app/(app)/admin/policies/page');

describe('관리자 페이지', () => {
  it('관리자 레이아웃은 역할을 다시 확인한다 (2차 방어)', async () => {
    render(await AdminLayout({ children: <p>관리 본문</p> }));
    expect(screen.getByText('관리 본문')).toBeInTheDocument();
    expect(calls.guards).toContain('admin-area');
  });

  it('사용자·권한 페이지는 users.manage 를 검사하고 표와 권한 매트릭스를 렌더한다', async () => {
    render(await AdminUsersPage());
    expect(calls.guards).toContain('users.manage:/admin/users');
    expect(screen.getByRole('table', { name: '사용자 목록' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '역할별 권한' })).toBeInTheDocument();
  });

  it('감사 로그 페이지는 audit.read 를 검사하고 필터를 유지한 CSV 링크를 제공한다', async () => {
    render(
      await AdminAuditPage({ searchParams: Promise.resolve({ action: 'auth.login', page: '3' }) }),
    );
    expect(calls.guards).toContain('audit.read:/admin/audit');
    expect(screen.getByRole('link', { name: 'CSV 내보내기' })).toHaveAttribute(
      'href',
      '/api/audit/export.csv?action=auth.login',
    );
    expect(screen.getByText('조건에 맞는 감사 로그가 없습니다.')).toBeInTheDocument();
  });

  it('가격정책 관리는 pricing.write 를 검사하고 임포트 패널·현재 적용 배지·최근 실패를 보인다', async () => {
    render(await AdminPoliciesPage());
    expect(calls.guards).toContain('pricing.write:/admin/policies');
    expect(screen.getByRole('heading', { level: 1, name: '가격정책 관리' })).toBeInTheDocument();
    expect(screen.getByLabelText('현재 적용')).toHaveTextContent('판매단가 병합_가격_raw.xlsx');
    expect(screen.getByLabelText('현재 적용')).toHaveTextContent('품목상태 없음');
    expect(screen.getByRole('region', { name: '가격정책 파일 적용' })).toBeInTheDocument();
    expect(screen.getByText(/최근 실패한 적용/)).toHaveTextContent('불변식 I-1 위반');
  });
});
