import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserRow } from '@/features/users/UsersTable';

/** 사용자·권한 화면 (디자인 "사용자 · 권한 관리") — Server Action 은 모킹 */
const actions = vi.hoisted(() => ({
  createUserAction: vi.fn(),
  updateUserAction: vi.fn(),
  deactivateUserAction: vi.fn(),
}));
const refresh = vi.fn();

vi.mock('@/features/users/actions', () => actions);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn() }),
  usePathname: () => '/admin/users',
  useSearchParams: () => new URLSearchParams(),
}));

const { UsersTable } = await import('@/features/users/UsersTable');
const { PermissionMatrix } = await import('@/features/users/PermissionMatrix');

const USERS: UserRow[] = [
  {
    id: 'a',
    email: 'admin@pentasecurity.com',
    name: '관리자',
    department: '가격정책팀',
    role: 'ADMIN',
    status: 'active',
    createdVia: 'bootstrap',
    lastLoginAt: '2026-09-23T01:02:03.000Z',
  },
  {
    id: 'b',
    email: 'member@pentasecurity.com',
    name: '멤버',
    department: null,
    role: 'USER',
    status: 'active',
    createdVia: 'admin',
    lastLoginAt: null,
  },
  {
    id: 'c',
    email: 'gone@pentasecurity.com',
    name: '퇴사자',
    department: null,
    role: 'USER',
    status: 'inactive',
    createdVia: 'auto',
    lastLoginAt: null,
  },
];

const ok = (data: unknown) => ({ ok: true, data });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UsersTable', () => {
  it('디자인 열(이름·이메일·부서·역할·상태·마지막 로그인·관리)과 행을 렌더한다', () => {
    render(<UsersTable users={USERS} currentUserId="a" />);
    const table = screen.getByRole('table', { name: '사용자 목록' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual(['이름', '이메일', '부서', '역할', '상태', '마지막 로그인', '관리']);
    expect(screen.getByRole('heading', { level: 1, name: '사용자 · 권한 관리' })).toBeVisible();
    expect(screen.getByText('(나)')).toBeInTheDocument();
    expect(screen.getByText('2026-09-23 10:02:03')).toBeInTheDocument(); // KST
    expect(screen.getByText('미로그인 · 사전 등록')).toBeInTheDocument();
    expect(screen.getByText('비활성')).toBeInTheDocument();
    // '비활성' 필 = Status Badge error: Error 50 바탕 + Error 700 글자 (500 글자는 AA 미달, A-1 QA 백로그 → Penta PR-2)
    expect(screen.getByText('비활성')).toHaveClass('bg-error-50', 'text-error-700');
    expect(screen.getByText('비활성')).not.toHaveClass('text-red-500');
    // 본인·이미 비활성 사용자는 비활성화 버튼이 꺼진다
    expect(screen.getByRole('button', { name: 'admin@pentasecurity.com 비활성화' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'gone@pentasecurity.com 비활성화' })).toBeDisabled();
  });

  it('+ 사용자 추가 → 이메일 사전 등록 Action 호출 후 새로고침', async () => {
    actions.createUserAction.mockResolvedValue(ok({ id: 'n' }));
    render(<UsersTable users={USERS} currentUserId="a" />);

    await userEvent.click(screen.getByRole('button', { name: '+ 사용자 추가' }));
    const dialog = screen.getByRole('dialog', { name: '사용자 추가' });
    await userEvent.type(within(dialog).getByLabelText('이메일'), 'new@pentasecurity.com');
    await userEvent.type(within(dialog).getByLabelText('부서'), '영업팀');
    await userEvent.selectOptions(within(dialog).getByLabelText('역할'), 'ADMIN');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(actions.createUserAction).toHaveBeenCalledWith({
      email: 'new@pentasecurity.com',
      name: '',
      department: '영업팀',
      role: 'ADMIN',
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('수정 실패 시 모달 안에 오류와 필드 오류를 표시한다', async () => {
    actions.updateUserAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION',
        message: '입력값을 확인하세요',
        fieldErrors: { name: ['필수'] },
      },
    });
    render(<UsersTable users={USERS} currentUserId="a" />);

    await userEvent.click(screen.getByRole('button', { name: 'member@pentasecurity.com 수정' }));
    const dialog = screen.getByRole('dialog', { name: '사용자 수정' });
    expect(within(dialog).getByLabelText('이메일')).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('상태'), 'inactive');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(actions.updateUserAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b', role: 'USER', status: 'inactive' }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('입력값을 확인하세요');
    expect(within(dialog).getByText('필수')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('비활성화는 확인 모달을 거쳐 Action 을 호출한다', async () => {
    actions.deactivateUserAction.mockResolvedValue(ok({ id: 'b' }));
    render(<UsersTable users={USERS} currentUserId="a" />);

    await userEvent.click(
      screen.getByRole('button', { name: 'member@pentasecurity.com 비활성화' }),
    );
    const dialog = screen.getByRole('dialog', { name: '사용자 비활성화' });
    await userEvent.click(within(dialog).getByRole('button', { name: '비활성화' }));

    expect(actions.deactivateUserAction).toHaveBeenCalledWith({ id: 'b' });
    expect(refresh).toHaveBeenCalled();
  });

  it('비활성화 실패는 표 위에 오류로 보인다', async () => {
    actions.deactivateUserAction.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION', message: '마지막 관리자는 해제하거나 비활성화할 수 없습니다' },
    });
    render(<UsersTable users={USERS} currentUserId="a" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'member@pentasecurity.com 비활성화' }),
    );
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '사용자 비활성화' })).getByRole('button', {
        name: '비활성화',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.getByRole('alert')).toHaveTextContent('마지막 관리자');
  });
});

describe('PermissionMatrix', () => {
  it('PERMISSIONS 상수로 USER/ADMIN 허용 여부를 렌더하고 역할 추가는 안내만 한다', () => {
    render(<PermissionMatrix />);
    const table = screen.getByRole('table', { name: '역할별 권한' });
    const row = (label: string) => within(table).getByText(label).closest('tr') as HTMLElement;
    expect(within(row('가격정책 조회')).getAllByLabelText('허용')).toHaveLength(2);
    // #31: notification.self 행 (USER·ADMIN 모두 허용)
    expect(within(row('내 알림')).getAllByLabelText('허용')).toHaveLength(2);
    expect(within(row('사용자 · 권한 관리')).getByLabelText('불가')).toBeInTheDocument();
    // 조달이 통합 D-1: 조회는 USER·ADMIN, 관리는 ADMIN 만
    expect(
      within(row('조달 조회 (실적 현황 · 등록 품목 · 입찰 공고)')).getAllByLabelText('허용'),
    ).toHaveLength(2);
    expect(
      within(row('조달 관리 (실적 · 품목 · 키워드)')).getByLabelText('불가'),
    ).toBeInTheDocument();
    expect(
      within(row('조달 관리 (실적 · 품목 · 키워드)')).getByLabelText('허용'),
    ).toBeInTheDocument();
    expect(
      within(row('원가 조회 · 등록 · 수정 · 삭제')).getByLabelText('허용'),
    ).toBeInTheDocument();
    expect(screen.getByText(/\+ 역할 추가/)).toBeInTheDocument();
  });
});
