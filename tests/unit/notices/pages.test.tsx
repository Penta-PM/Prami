import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** 홈·공지 목록/상세·공지 관리·검색 페이지 조립 (서버 컴포넌트) — 권한 가드·쿼리는 모킹 */
const calls = vi.hoisted(() => ({
  guards: [] as string[],
  role: 'USER' as 'USER' | 'ADMIN',
  searches: [] as string[],
}));

vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/auth/rbac', () => ({
  requirePagePermission: async (permission: string, path: string) => {
    calls.guards.push(`${permission}:${path}`);
    return { id: 'u', email: 'x@pentasecurity.com', name: '픽스처', role: calls.role };
  },
}));
const NOTICE = {
  id: '11111111-0000-4000-8000-000000000001',
  title: '플랫폼 오픈 안내',
  authorName: '가격정책팀',
  isImportant: true,
  publishedAt: '2026-09-01',
};
vi.mock('@/server/notices/queries', () => ({
  listNotices: async (_db: unknown, limit?: number) =>
    Array.from({ length: limit ?? 7 }, (_, index) => ({
      ...NOTICE,
      id: `${NOTICE.id.slice(0, -1)}${index + 1}`,
      title: `공지 ${index + 1}`,
      isImportant: index === 0,
    })),
  listNoticesWithBody: async () => [{ ...NOTICE, body: '본문' }],
  getNotice: async (_db: unknown, id: string) =>
    id === NOTICE.id ? { ...NOTICE, body: '본문' } : null,
}));
vi.mock('@/server/search/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/search/queries')>()),
  searchAll: async (_db: unknown, query: string) => {
    calls.searches.push(query);
    return { query, items: [], notices: [NOTICE], truncated: { items: false, notices: false } };
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/features/notices/actions', () => ({}));

// 조회 상태 복원·저장(page-state-memory B-1)은 tests/unit/page-state 에서 검증한다 — 여기서는 화면 렌더만
vi.mock('@/server/page-state/restore-page', () => ({
  restoreViewState: async (pageKey: string) => ({ pageKey, savedQuery: null, restoreTop: null }),
}));
vi.mock('@/features/page-state/ViewStateTracker', () => ({ ViewStateTracker: () => null }));

const { default: HomePage } = await import('@/app/(app)/page');
const { default: NoticesPage } = await import('@/app/(app)/notices/page');
const { default: NoticeDetailPage } = await import('@/app/(app)/notices/[id]/page');
const { default: AdminNoticesPage } = await import('@/app/(app)/admin/notices/page');
const { default: SearchPage } = await import('@/app/(app)/search/page');

describe('/ (AC-50)', () => {
  it('제품 카드 4개 + 최근 공지 5건(중요 배지) + 전체보기', async () => {
    render(await HomePage());
    expect(screen.getByRole('heading', { level: 2, name: '제품 바로가기' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /가격 정책 보기/ })).toHaveLength(4);
    const rows = screen.getByRole('list', { name: '공지 목록' });
    expect(rows.querySelectorAll('li')).toHaveLength(5);
    expect(rows).toHaveTextContent('중요');
    expect(screen.getByRole('link', { name: '전체보기 →' })).toHaveAttribute('href', '/notices');
  });
});

describe('/notices, /notices/[id]', () => {
  it('목록은 notice.read 가드 + 전체 행', async () => {
    render(await NoticesPage());
    expect(calls.guards).toContain('notice.read:/notices');
    expect(screen.getByRole('list', { name: '공지 목록' }).querySelectorAll('li')).toHaveLength(7);
  });

  it('상세: USER 에게는 수정/삭제 버튼이 없고 ADMIN 에게는 있다 (AC-51); 없는 id 는 notFound', async () => {
    calls.role = 'USER';
    const { unmount } = render(
      await NoticeDetailPage({ params: Promise.resolve({ id: NOTICE.id }) }),
    );
    expect(screen.getByRole('heading', { level: 1, name: '플랫폼 오픈 안내' })).toBeInTheDocument();
    expect(screen.getByText('본문')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
    unmount();

    calls.role = 'ADMIN';
    render(await NoticeDetailPage({ params: Promise.resolve({ id: NOTICE.id }) }));
    expect(screen.getByRole('button', { name: '수정' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
    await expect(
      NoticeDetailPage({ params: Promise.resolve({ id: '11111111-0000-4000-8000-0000000000ff' }) }),
    ).rejects.toThrow('NOT_FOUND');
    await expect(
      NoticeDetailPage({ params: Promise.resolve({ id: 'not-a-uuid' }) }),
    ).rejects.toThrow('NOT_FOUND');
  });
});

describe('/admin/notices', () => {
  it('notice.write 가드 + 관리 표 + 등록 버튼', async () => {
    calls.role = 'ADMIN';
    render(await AdminNoticesPage({ searchParams: Promise.resolve({}) }));
    expect(calls.guards).toContain('notice.write:/admin/notices');
    expect(screen.getByRole('table', { name: '공지 관리 표' })).toHaveTextContent(
      '플랫폼 오픈 안내',
    );
    expect(screen.getByRole('button', { name: '+ 공지 등록' })).toBeInTheDocument();
  });
});

describe('/search (AC-52)', () => {
  it('search 가드, ?q= 정규화 후 검색, 결과 그룹 렌더', async () => {
    render(await SearchPage({ searchParams: Promise.resolve({ q: '  Wapples-500 ' }) }));
    expect(calls.guards).toContain('search:/search');
    expect(calls.searches.at(-1)).toBe('Wapples-500');
    expect(screen.getByRole('heading', { level: 2, name: /공지사항/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /품목/ })).toBeInTheDocument();
  });
});
