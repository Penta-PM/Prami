import { render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { procurementAppState, procurementBidNotices } from '@/db/schema/procurement';

import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조달이 통합 UI-3 — /procurement/bids 화면(서버 컴포넌트) + PGlite + 실제 조회(getBidNoticeRows·getCollectionStatus).
 * 합성 공고만(가상 기관·example.invalid). 기준 시각은 실제 지금 — 마감은 지금에서 상대적으로 둔다.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
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
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/procurement/bids',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/page-state/ViewStateTracker', () => ({ ViewStateTracker: () => null }));

const { default: BidsPage } = await import('@/app/(app)/procurement/bids/page');
const { writeViewQuery } = await import('@/server/page-state/store');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

const open = (params: Record<string, string> = {}) =>
  BidsPage({ searchParams: Promise.resolve(params) });

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);

let userId: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  await state.handle.db.insert(procurementBidNotices).values([
    {
      bidNo: 'SYN-001',
      title: '가상 기관 웹방화벽 고도화',
      products: ['WAPPLES'],
      demandOrg: '가상 수요기관 A',
      postedAt: at(-2),
      deadlineAt: at(10),
      budget: 1_234_000_000,
      estPrice: 1_100_000_000,
      detailUrl: 'https://example.invalid/bids/SYN-001',
      fitGrade: '상',
      fitScore: 91,
      fitReasons: ['＋ 공고명에 제품 키워드', '－ 용역 공고'],
    },
    {
      bidNo: 'SYN-002',
      title: '가상 기관 DB 암호화 구축',
      products: ['D.AMO'],
      postedAt: at(-1),
      deadlineAt: at(1.5),
      budget: 45_670_000,
      fitGrade: '중',
      fitScore: 60,
    },
    {
      bidNo: 'SYN-003',
      title: '가상 기관 통합인증 지난 공고',
      products: ['iSIGN'],
      postedAt: at(-30),
      deadlineAt: at(-5),
      fitGrade: '상',
      fitScore: 80,
    },
    { bidNo: 'SYN-004', title: '관련 제품 없는 공고', products: [], fitGrade: '상' },
  ]);
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  state.sessionUserId = userId;
});

describe('/procurement/bids', () => {
  it('기본(진행 중·적합도순): 칩 건수·표·마지막 확인 시각 없음', async () => {
    render(await open());
    expect(screen.getByRole('heading', { level: 1, name: '입찰 공고' })).toBeInTheDocument();
    expect(screen.getByTestId('procurement-bids-last-checked')).toHaveTextContent('확인 기록 없음');
    const chips = within(screen.getByRole('group', { name: '제품' })).getAllByRole('button');
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      '전체 2건',
      'WAPPLES 1건',
      'D.AMO 1건',
      'iSIGN 0건',
    ]);
    const table = screen.getByRole('table', { name: '입찰 공고 목록' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[2]!.textContent)).toEqual([
      expect.stringContaining('가상 기관 웹방화벽 고도화'),
      expect.stringContaining('가상 기관 DB 암호화 구축'),
    ]);
    expect(within(rows[0]!).getByText('12억 3,400만')).toBeInTheDocument();
    expect(within(rows[1]!).getByTestId('bid-deadline-badge')).toHaveAttribute(
      'data-tone',
      'urgent',
    );
    expect(screen.getByRole('navigation', { name: '페이지' })).toHaveTextContent(
      '총 2건 · 1 / 1 페이지',
    );
  });

  it('마감 포함·제품·게시순은 URL 에서 읽는다 — 마감된 공고는 "마감" 표시', async () => {
    render(await open({ closed: '1', product: 'iSIGN', sort: 'posted' }));
    expect(screen.getByRole('radio', { name: '마감 포함' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '게시순' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'iSIGN 1건' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-closed', 'true');
    expect(within(rows[0]!).getByTestId('bid-deadline-badge')).toHaveTextContent('마감');
  });

  it('조건에 맞는 공고가 없으면 빈 상태 + 넓히기 안내', async () => {
    render(await open({ product: 'iSIGN' }));
    expect(screen.queryByRole('table')).toBeNull();
    const empty = screen.getByTestId('bid-empty');
    expect(empty).toHaveTextContent('조건에 맞는 입찰 공고가 없습니다');
    expect(empty).toHaveTextContent('마감 포함');
  });

  it('마지막 확인 시각(app_state `bids` 값의 last_checked)을 KST 로', async () => {
    await state.handle!.db.insert(procurementAppState).values({
      key: 'bids',
      value: { last_checked: '2026-10-27T01:15:00+00:00' },
    });
    render(await open());
    expect(screen.getByTestId('procurement-bids-last-checked')).toHaveTextContent(
      '2026-10-27 10:15 (KST)',
    );
    await state.handle!.db.delete(procurementAppState);
  });

  it('파라미터 없는 진입은 저장된 조회 상태로 복원 redirect (B-1)', async () => {
    await writeViewQuery(state.handle!.db, userId, 'procurement-bids', 'product=D.AMO&top=1');
    await expect(open()).rejects.toThrow('NEXT_REDIRECT:/procurement/bids?product=D.AMO&top=1');
    await writeViewQuery(state.handle!.db, userId, 'procurement-bids', '');
  });
});
