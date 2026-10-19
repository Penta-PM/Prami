import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** /admin/parts, /admin/groups 조립 (서버 컴포넌트) — 권한 가드·쿼리는 모킹 */
const calls = vi.hoisted(() => ({
  guards: [] as string[],
  families: [] as (string | undefined)[],
}));

vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/auth/rbac', () => ({
  requirePagePermission: async (permission: string, path: string) => {
    calls.guards.push(`${permission}:${path}`);
    return { id: 'a', email: 'admin@pentasecurity.com', name: '관리자', role: 'ADMIN' };
  },
}));
vi.mock('@/server/parts/catalog', () => ({
  listProductFamilies: async () => ['D.AMO', 'WAPPLES'],
  listPartsCatalog: async (_db: unknown, family: string) => {
    calls.families.push(family);
    return {
      models: [
        {
          itemCode: 'P1010010004',
          itemName: 'Wapples-2700 (H2700)',
          productFamily: family,
          kind: '본품',
        },
      ],
      parts: [{ itemCode: 'P10800011', itemName: 'N_51080', productFamily: family, kind: '파츠' }],
    };
  },
}));
vi.mock('@/server/parts/queries', () => ({
  listPartMappings: async () => [
    {
      modelItemCode: 'P1010010004',
      modelName: 'Wapples-2700 (H2700)',
      productFamily: 'WAPPLES',
      parts: [{ itemCode: 'P10800011', itemName: 'N_51080' }],
    },
  ],
}));
vi.mock('@/server/imports/queries', () => ({ listReusableBatches: async () => [] }));
vi.mock('@/server/groups/queries', () => ({
  listSolutionGroups: async (_db: unknown, family?: string) =>
    family === 'D.AMO'
      ? []
      : [{ id: 'g1', productFamily: 'WAPPLES', name: 'WAPPLES 기본', items: [] }],
  listGroupCandidates: async () => [],
}));
vi.mock('@/features/parts/actions', () => ({}));
vi.mock('@/features/groups/actions', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/parts',
  useSearchParams: () => new URLSearchParams(),
}));

const { default: AdminPartsPage } = await import('@/app/(app)/admin/parts/page');
const { default: AdminGroupsPage } = await import('@/app/(app)/admin/groups/page');

describe('/admin/parts', () => {
  it('parts.write 가드, 기본 탭 WAPPLES, 등록 방식 토글·수동 등록·등록된 매핑 표', async () => {
    render(await AdminPartsPage({ searchParams: Promise.resolve({}) }));
    expect(calls.guards).toContain('parts.write:/admin/parts');
    expect(calls.families.at(-1)).toBe('WAPPLES');
    expect(screen.getByRole('heading', { level: 1, name: '파츠 관리' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'WAPPLES' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('radio', { name: '수동 등록' })).toBeChecked();
    expect(screen.getByRole('table', { name: '등록된 매핑 표' })).toHaveTextContent(
      'N_51080 (P10800011)',
    );
  });

  it('?family= 로 탭을 바꾼다', async () => {
    render(await AdminPartsPage({ searchParams: Promise.resolve({ family: 'D.AMO' }) }));
    expect(calls.families.at(-1)).toBe('D.AMO');
  });
});

describe('/admin/groups', () => {
  it('groups.write 가드, 탭 건수, 카드 목록 + 그룹 생성 버튼', async () => {
    render(await AdminGroupsPage({ searchParams: Promise.resolve({ family: 'WAPPLES' }) }));
    expect(calls.guards).toContain('groups.write:/admin/groups');
    expect(screen.getByRole('heading', { level: 1, name: '솔루션 그룹 관리' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /WAPPLES/ })).toHaveTextContent('1');
    expect(screen.getByRole('list', { name: '솔루션 그룹 목록' })).toHaveTextContent(
      'WAPPLES 기본',
    );
    expect(screen.getByRole('button', { name: '+ 그룹 생성' })).toBeInTheDocument();
  });
});
