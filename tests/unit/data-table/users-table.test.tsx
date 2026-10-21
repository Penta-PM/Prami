import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserRow } from '@/features/users/UsersTable';

/** #32 PR-1 파일럿: UsersTable 이 공용 DataTable(클라이언트 정렬)로 동작한다 — Server Action 은 모킹 */
vi.mock('@/features/users/actions', () => ({
  createUserAction: vi.fn(),
  updateUserAction: vi.fn(),
  deactivateUserAction: vi.fn(),
}));
// 정렬·필터는 URL 상태(page-state-memory §2.2-6) — router.replace 가 useSearchParams 를 바꾸는 메모리 더블
vi.mock(
  'next/navigation',
  async () => (await import('../../helpers/next-navigation')).navigationModule,
);
const { navigation } = await import('../../helpers/next-navigation');

const { UsersTable } = await import('@/features/users/UsersTable');

const user = (patch: Partial<UserRow> & Pick<UserRow, 'id' | 'name'>): UserRow => ({
  email: `${patch.id}@pentasecurity.com`,
  department: null,
  role: 'USER',
  status: 'active',
  createdVia: 'admin',
  lastLoginAt: null,
  ...patch,
});

const USERS: UserRow[] = [
  user({ id: 'a', name: '나', role: 'USER', lastLoginAt: '2026-09-02T00:00:00.000Z' }),
  user({ id: 'b', name: '가', role: 'ADMIN', status: 'inactive' }),
  user({ id: 'c', name: '다', role: 'USER', lastLoginAt: '2026-09-01T00:00:00.000Z' }),
  user({ id: 'd', name: '라', role: 'ADMIN', department: '영업팀' }),
];

const table = () => screen.getByRole('table', { name: '사용자 목록' });
const th = (name: string) => within(table()).getByRole('columnheader', { name });
const names = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

beforeEach(() => {
  navigation.reset('/admin/users');
  localStorage.clear();
});

describe('UsersTable (DataTable 파일럿)', () => {
  it('역할은 ADMIN → USER 정의 순서, 이름은 가나다, 마지막 로그인은 미로그인이 맨 뒤', async () => {
    render(<UsersTable users={USERS} currentUserId="a" />);
    await userEvent.click(within(th('역할')).getByRole('button'));
    expect(names()).toEqual(['가', '라', '나(나)', '다']);

    await userEvent.click(within(th('이름')).getByRole('button'));
    expect(names()).toEqual(['가', '나(나)', '다', '라']);

    await userEvent.click(within(th('마지막 로그인')).getByRole('button'));
    await userEvent.click(within(th('마지막 로그인')).getByRole('button'));
    expect(th('마지막 로그인')).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['나(나)', '다', '가', '라']);
  });

  it('빠른 두 번 클릭(BL-2, page-state-memory §6): router.replace 가 반영되기 전 두 번째 클릭은 dir=desc 를 요청한다', () => {
    const original = navigation.replace.getMockImplementation();
    const lagged: string[] = [];
    navigation.replace.mockImplementation((href: string) => {
      lagged.push(href); // URL 갱신을 미룬다 — 실제 라우터의 비동기 반영
    });
    try {
      render(<UsersTable users={USERS} currentUserId="a" />);
      const button = within(th('이메일')).getByRole('button');
      fireEvent.click(button);
      fireEvent.click(button);
      expect(lagged).toEqual([
        '/admin/users?sort=email&dir=asc',
        '/admin/users?sort=email&dir=desc',
      ]);
      // 라우터가 차례로 따라잡으면 내림차순
      act(() => {
        for (const href of lagged) original?.(href);
      });
      expect(th('이메일')).toHaveAttribute('aria-sort', 'descending');
      expect(navigation.search()).toBe('sort=email&dir=desc');
    } finally {
      if (original) navigation.replace.mockImplementation(original);
    }
  });

  it("관리 열은 정렬·이동하지 않고, '열 초기화'는 기본 상태에서 비활성이다", () => {
    render(<UsersTable users={USERS} currentUserId="a" />);
    expect(within(th('관리')).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: '열 초기화' })).toBeDisabled();
  });

  it('저장 키는 현재 사용자 id 로 구분된다', async () => {
    render(<UsersTable users={USERS} currentUserId="a" />);
    within(th('이름')).getByRole('button').focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(localStorage.getItem('prami:table:users:v1:a')).not.toBeNull();
    expect(screen.getByRole('button', { name: '열 초기화' })).toBeEnabled();
  });
});
