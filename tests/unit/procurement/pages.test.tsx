import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { procurementJobRuns } from '@/db/schema/procurement';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조달이 통합 UI-1 화면 셸 — PGlite + 실제 세션 가드 경로(requirePagePermission). 세션·요청 메타·라우터만 모킹.
 * - 가드: 비로그인 → /login(callbackUrl), 권한 없음 → / (+ 감사 denied). 직접 URL 접근 차단.
 * - 머리: 수집 기록이 없으면 "아직 수집 기록이 없습니다", 있으면 KST 시각(작업별 — 입찰 공고는 bids).
 * - 조회 상태(B-1): 관리 화면은 파라미터 없는 진입에 저장된 탭으로 redirect.
 * - 관리 탭 전환: 자리 표시 교체 + ?tab= router.replace.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
  replace: [] as string[],
  push: [] as string[],
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: '198.51.100.7', userAgent: 'vitest' }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({
    replace: (href: string) => state.replace.push(href),
    push: (href: string) => state.push.push(href),
    refresh: vi.fn(),
  }),
  usePathname: () => '/admin/procurement',
  useSearchParams: () => new URLSearchParams(),
}));
// 저장 트래커(클라이언트·서버 액션)는 tests/unit/page-state 에서 검증한다 — 여기서는 복원 redirect 와 렌더만
vi.mock('@/features/page-state/ViewStateTracker', () => ({ ViewStateTracker: () => null }));
// 키워드 탭 RSC(PGlite 조회·편집기)는 keywords-section.test 에서 검증한다 — 여기서는 탭 switch 가 고르는 것만
vi.mock('@/features/procurement/admin/keywords/KeywordsAdminSection', () => ({
  KeywordsAdminSection: ({ access }: { access: { scope: string } }) => (
    <p>키워드 관리 섹션 ({access.scope})</p>
  ),
}));

const { default: PerformancePage } = await import('@/app/(app)/procurement/page');
const { default: ItemsPage } = await import('@/app/(app)/procurement/items/page');
const { default: BidsPage } = await import('@/app/(app)/procurement/bids/page');
const { default: AdminPage } = await import('@/app/(app)/admin/procurement/page');
const { writeViewQuery } = await import('@/server/page-state/store');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

type Page = (props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<React.ReactElement>;

/** emptyText: 조달 데이터 0행일 때 본문 상태 — 실적 현황(UI-5)·등록 품목(UI-2)·입찰 공고(UI-3) 모두 빈 안내 */
const PAGES: { path: string; page: Page; title: string; emptyText: string }[] = [
  {
    path: '/procurement',
    page: PerformancePage,
    title: '조달 실적 현황',
    emptyText: '전체 조달 실적이 없습니다',
  },
  {
    path: '/procurement/items',
    page: ItemsPage,
    title: '등록 품목',
    emptyText: '등록된 품목이 없습니다',
  },
  {
    path: '/procurement/bids',
    page: BidsPage,
    title: '입찰 공고',
    emptyText: '진행 중인 입찰 공고가 없습니다',
  },
];

const open = (page: Page, params: Record<string, string> = {}) =>
  page({ searchParams: Promise.resolve(params) });

let adminId: string;
let userId: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(async () => {
  invalidateSessionUser();
  state.sessionUserId = undefined;
  state.replace.length = 0;
  state.push.length = 0;
  await state.handle!.db.delete(procurementJobRuns);
});

describe('조달 화면 가드 (직접 URL 접근)', () => {
  it.each([...PAGES, { path: '/admin/procurement', page: AdminPage as Page, title: '조달 관리' }])(
    '비로그인 $path → /login?callbackUrl',
    async ({ path, page }) => {
      await expect(open(page)).rejects.toThrow(
        `NEXT_REDIRECT:/login?callbackUrl=${encodeURIComponent(path)}`,
      );
    },
  );

  it('USER 는 /admin/procurement 에서 / 로 이동하고 감사 denied(procurement.write)', async () => {
    state.sessionUserId = userId;
    await expect(open(AdminPage)).rejects.toThrow(/^NEXT_REDIRECT:\/$/);
    const denied = await auditByAction(state.handle!, 'auth.access_denied');
    expect(denied.at(-1)).toMatchObject({
      actorUserId: userId,
      targetId: '/admin/procurement',
      result: 'denied',
      after: { permission: 'procurement.write', role: 'USER' },
    });
  });

  it.each(PAGES)('USER 는 $path 를 연다 (procurement.read)', async ({ page, title, emptyText }) => {
    state.sessionUserId = userId;
    render(await open(page));
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(emptyText, { exact: false })).toBeInTheDocument();
  });
});

describe('ProcurementHeader 수집 시각', () => {
  it.each(PAGES)('$path: 수집 기록이 없으면 안내 문구', async ({ page }) => {
    state.sessionUserId = userId;
    render(await open(page));
    expect(screen.getByTestId('procurement-collected-at')).toHaveTextContent(
      '아직 수집 기록이 없습니다',
    );
    expect(screen.getByText('데이터 기준')).toBeInTheDocument();
  });

  it('실적 현황은 daily, 입찰 공고는 bids 작업 기준 KST 시각', async () => {
    state.sessionUserId = userId;
    await state.handle!.db.insert(procurementJobRuns).values({
      job: 'daily',
      status: 'ok',
      startedAt: new Date('2026-10-26T23:50:00Z'),
      finishedAt: new Date('2026-10-27T00:30:00Z'),
    });
    const { unmount } = render(await open(PerformancePage));
    expect(screen.getByTestId('procurement-collected-at')).toHaveTextContent(
      '2026-10-27 09:30 (KST)',
    );
    unmount();
    render(await open(BidsPage));
    expect(screen.getByTestId('procurement-collected-at')).toHaveTextContent(
      '아직 수집 기록이 없습니다',
    );
  });
});

describe('/admin/procurement (ADMIN)', () => {
  it('탭 3개, 기본 실적 관리 — 단계 3 자리 표시', async () => {
    state.sessionUserId = adminId;
    render(await open(AdminPage));
    expect(screen.getByRole('heading', { level: 1, name: '조달 관리' })).toBeInTheDocument();
    const tabs = screen.getByRole('radiogroup', { name: '조달 관리 메뉴' });
    expect(
      within(tabs)
        .getAllByRole('radio')
        .map((tab) => tab.textContent),
    ).toEqual(['실적 관리', '품목 관리', '키워드 관리']);
    expect(screen.getByRole('radio', { name: '실적 관리' })).toBeChecked();
    expect(screen.getByRole('region', { name: '실적 관리' })).toHaveTextContent('단계 3에서 제공');
  });

  it('?tab=items 는 품목 관리 자리 표시', async () => {
    state.sessionUserId = adminId;
    render(await open(AdminPage, { tab: 'items' }));
    expect(screen.getByRole('radio', { name: '품목 관리' })).toBeChecked();
    expect(screen.getByRole('region', { name: '품목 관리' })).toHaveTextContent('단계 3에서 제공');
  });

  it('?tab=keywords → 키워드 관리 RSC 섹션', async () => {
    state.sessionUserId = adminId;
    render(await open(AdminPage, { tab: 'keywords', f: 'x' }));
    expect(screen.getByRole('radio', { name: '키워드 관리' })).toBeChecked();
    expect(screen.getByRole('region', { name: '키워드 관리' })).toHaveTextContent(
      '키워드 관리 섹션 (write)',
    );
  });

  it('탭을 바꾸면 router.push(?tab=<next>) — 다른 파라미터는 버린다', async () => {
    state.sessionUserId = adminId;
    render(await open(AdminPage, { tab: 'items', page: '3' }));
    await userEvent.click(screen.getByRole('radio', { name: '키워드 관리' }));
    expect(state.push).toEqual(['/admin/procurement?tab=keywords']);
    expect(state.replace).toEqual([]);
    // 모킹 라우터는 페이지를 다시 그리지 않으므로 선택은 URL 의 탭(품목 관리)으로 돌아오고, 현재 탭을 누르면 이동하지 않는다
    expect(screen.getByRole('radio', { name: '품목 관리' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '품목 관리' }));
    expect(state.push).toHaveLength(1);
  });

  it('모르는 tab 값은 기본 탭', async () => {
    state.sessionUserId = adminId;
    render(await open(AdminPage, { tab: 'nope' }));
    expect(screen.getByRole('radio', { name: '실적 관리' })).toBeChecked();
  });

  it('파라미터 없는 진입은 저장된 탭으로 복원 redirect (B-1)', async () => {
    state.sessionUserId = adminId;
    await writeViewQuery(state.handle!.db, adminId, 'admin-procurement', 'tab=keywords');
    await expect(open(AdminPage)).rejects.toThrow('NEXT_REDIRECT:/admin/procurement?tab=keywords');
    await writeViewQuery(state.handle!.db, adminId, 'admin-procurement', '');
  });
});
