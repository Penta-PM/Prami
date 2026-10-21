import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import type { NoticeDetailView } from '@/features/notices/types';
import type { PartMappingView } from '@/features/parts/types';
import type { UserRow } from '@/features/users/UsersTable';
import { withSortQuery } from '@/lib/table/sort-param';

import { navigation } from '../../helpers/next-navigation';

/**
 * 클라이언트 표 정렬의 URL 이전 (page-state-memory §2.2-6 — #32 §5 개정)과 계산기 탭 URL 반영(§2.2-7).
 * 정렬은 router.replace 로 `sort`·`dir` 를 맨 뒤에 두고, URL 이 상태라 새로고침(같은 URL 로 다시 렌더) 뒤에도 유지된다.
 */
vi.mock(
  'next/navigation',
  async () => (await import('../../helpers/next-navigation')).navigationModule,
);
vi.mock('@/features/users/actions', () => ({
  createUserAction: vi.fn(),
  updateUserAction: vi.fn(),
  deactivateUserAction: vi.fn(),
}));
vi.mock('@/features/notices/actions', () => ({
  upsertNoticeAction: vi.fn(),
  deleteNoticeAction: vi.fn(),
}));
vi.mock('@/features/calculator/QuoteCalculator', () => ({
  QuoteCalculator: () => <section aria-label="견적 계산기 본문" />,
}));
vi.mock('@/features/calculator/MarginCalculator', () => ({
  MarginCalculator: () => <section aria-label="순매출 계산기 본문" />,
}));

const { UsersTable } = await import('@/features/users/UsersTable');
const { NoticesAdminTable } = await import('@/features/notices/NoticesAdminTable');
const { PartsMappingTable } = await import('@/features/parts/PartsMappingTable');
const { CalculatorTabs } = await import('@/features/calculator/CalculatorTabs');

const withMotion = { wrapper: MotionProvider };

const user = (patch: Partial<UserRow> & Pick<UserRow, 'id' | 'name'>): UserRow => ({
  email: `${patch.id}@pentasecurity.com`,
  department: null,
  role: 'USER',
  status: 'active',
  createdVia: 'admin',
  lastLoginAt: null,
  ...patch,
});
const USERS = [
  user({ id: 'a', name: '나' }),
  user({ id: 'b', name: '가', role: 'ADMIN' }),
  user({ id: 'c', name: '다' }),
];

const names = () =>
  within(screen.getByRole('table', { name: '사용자 목록' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const header = (table: string, name: string) =>
  within(screen.getByRole('table', { name: table })).getByRole('columnheader', { name });

beforeEach(() => {
  localStorage.clear();
});

describe('withSortQuery', () => {
  it('다른 파라미터 순서 유지 + sort·dir 맨 뒤, null 이면 둘 다 제거', () => {
    expect(withSortQuery('dir=asc&family=W&sort=x&f.a.has=1', { id: 'model', dir: 'desc' })).toBe(
      '?family=W&f.a.has=1&sort=model&dir=desc',
    );
    expect(withSortQuery('?sort=x&dir=asc', null)).toBe('');
    expect(withSortQuery('', { id: 'name', dir: 'asc' })).toBe('?sort=name&dir=asc');
  });
});

describe('사용자 표 정렬 = URL', () => {
  beforeEach(() => navigation.reset('/admin/users'));

  it('헤더 클릭 → router.replace(sort·dir 맨 뒤), 오름 → 내림 → 해제', async () => {
    navigation.reset('/admin/users', 'f.role.in=USER');
    const ue = userEvent.setup();
    render(<UsersTable users={USERS} currentUserId="a" />, withMotion);
    await ue.click(within(header('사용자 목록', '이름')).getByRole('button'));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      '/admin/users?f.role.in=USER&sort=name&dir=asc',
      { scroll: false },
    );
    expect(header('사용자 목록', '이름')).toHaveAttribute('aria-sort', 'ascending');
    await ue.click(within(header('사용자 목록', '이름')).getByRole('button'));
    expect(navigation.search()).toBe('f.role.in=USER&sort=name&dir=desc');
    await ue.click(within(header('사용자 목록', '이름')).getByRole('button'));
    expect(navigation.search()).toBe('f.role.in=USER');
  });

  it('새로고침·재진입(URL 에 정렬) → 같은 정렬로 렌더, 화이트리스트 밖 정렬은 무시', () => {
    navigation.reset('/admin/users', 'sort=name&dir=desc');
    const { unmount } = render(<UsersTable users={USERS} currentUserId="a" />, withMotion);
    expect(names()).toEqual(['다', '나(나)', '가']);
    expect(header('사용자 목록', '이름')).toHaveAttribute('aria-sort', 'descending');
    unmount();
    navigation.reset('/admin/users', 'sort=actions&dir=asc');
    render(<UsersTable users={USERS} currentUserId="a" />, withMotion);
    expect(names()).toEqual(['나(나)', '가', '다']);
  });

  it("'필터 초기화' → 열 필터·정렬을 한 번의 replace 로 함께 해제", async () => {
    navigation.reset('/admin/users', 'f.name.eq=%EC%97%86%EC%9D%8C&sort=name&dir=asc');
    const ue = userEvent.setup();
    render(<UsersTable users={USERS} currentUserId="a" />, withMotion);
    const table = screen.getByRole('table', { name: '사용자 목록' });
    await ue.click(within(table).getByRole('button', { name: '필터 초기화' }));
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenLastCalledWith('/admin/users', { scroll: false });
    expect(names()).toHaveLength(3);
  });
});

describe('공지·파츠 매핑 표 정렬 = URL', () => {
  const NOTICES: NoticeDetailView[] = [
    {
      id: 'n1',
      title: '나',
      authorName: 'x',
      isImportant: false,
      publishedAt: '2026-09-01',
      body: '',
    },
    {
      id: 'n2',
      title: '가',
      authorName: 'x',
      isImportant: true,
      publishedAt: '2026-09-02',
      body: '',
    },
  ];
  const MAPPINGS: PartMappingView[] = [
    { modelItemCode: 'P2', modelName: 'W-2700', parts: [] },
    { modelItemCode: 'P1', modelName: 'W-1200', parts: [] },
  ] as unknown as PartMappingView[];

  it('공지: URL 정렬이 렌더에 반영되고 클릭은 URL 을 바꾼다', async () => {
    navigation.reset('/admin/notices', 'sort=title&dir=asc');
    const ue = userEvent.setup();
    render(<NoticesAdminTable notices={NOTICES} defaultAuthor="관리자" userId="u1" />, withMotion);
    expect(header('공지 관리 표', '제목')).toHaveAttribute('aria-sort', 'ascending');
    await ue.click(within(header('공지 관리 표', '작성일')).getByRole('button'));
    expect(navigation.search()).toBe('sort=publishedAt&dir=asc');
  });

  it('파츠: 제품군 탭(family)은 그대로 두고 sort·dir 를 붙인다', async () => {
    navigation.reset('/admin/parts', 'family=WAPPLES');
    const ue = userEvent.setup();
    render(
      <PartsMappingTable mappings={MAPPINGS} onEdit={vi.fn()} onDelete={vi.fn()} userId="u1" />,
      withMotion,
    );
    await ue.click(within(header('등록된 매핑 표', '모델')).getByRole('button'));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      '/admin/parts?family=WAPPLES&sort=model&dir=asc',
      { scroll: false },
    );
  });
});

describe('계산기 탭 = URL (?tab=)', () => {
  it('탭 전환 시 router.replace 로 ?tab= 반영 (스크롤 유지 옵션)', async () => {
    navigation.reset('/calculator', 'family=WAPPLES&item=P1');
    const ue = userEvent.setup();
    render(
      <CalculatorTabs userId="u1" preload={[]} savedQuotes={[]} canSeeCost={false} />,
      withMotion,
    );
    await ue.click(screen.getByRole('radio', { name: '순매출 계산기' }));
    expect(navigation.replace).toHaveBeenLastCalledWith('/calculator?tab=margin', {
      scroll: false,
    });
    expect(screen.getByRole('region', { name: '순매출 계산기 본문' })).toBeInTheDocument();
    await ue.click(screen.getByRole('radio', { name: '견적 계산기' }));
    expect(navigation.search()).toBe('tab=quote');
  });
});
