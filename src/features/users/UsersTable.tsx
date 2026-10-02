'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import {
  Button,
  Modal,
  Pill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import { formatAuditTime } from '@/lib/audit-format';
import type { ActionResult } from '@/lib/result';

import { deactivateUserAction } from './actions';
import { UserFormModal, type UserFormMode } from './UserFormModal';

export type UserRow = {
  id: string;
  email: string;
  name: string;
  department: string | null;
  role: 'USER' | 'ADMIN';
  status: 'active' | 'inactive';
  createdVia: 'bootstrap' | 'auto' | 'admin';
  lastLoginAt: string | null;
};

type UsersTableProps = { users: readonly UserRow[]; currentUserId: string };

const CREATED_VIA_LABELS: Record<UserRow['createdVia'], string> = {
  admin: '사전 등록',
  auto: '자동 생성',
  bootstrap: '부트스트랩',
};

/** 사용자 표 (디자인 "사용자 · 권한 관리"): 이름·이메일·부서·역할·상태·마지막 로그인·관리 */
export function UsersTable({ users, currentUserId }: UsersTableProps) {
  const router = useRouter();
  const [form, setForm] = useState<UserFormMode | null>(null);
  const [confirming, setConfirming] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDone = (result: ActionResult<unknown>) => {
    if (!result.ok) return setError(result.error.message);
    setError(null);
    setForm(null);
    setConfirming(null);
    router.refresh();
  };

  const deactivate = (user: UserRow) =>
    startTransition(async () => handleDone(await deactivateUserAction({ id: user.id })));

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          사용자 · 권한 관리
        </h1>
        <Button variant="primary" size="sm" onClick={() => setForm({ kind: 'create' })}>
          + 사용자 추가
        </Button>
      </div>

      <Presence>
        {error && !form ? (
          <Collapse key="error" role="alert">
            <p className="m-0 mb-4 rounded-lg bg-red-500/10 px-3.5 py-3 text-[13px] text-red-500">
              {error}
            </p>
          </Collapse>
        ) : null}
      </Presence>

      <div className="overflow-hidden rounded-[10px] bg-surface-card shadow-(--hairline-default)">
        <Table aria-label="사용자 목록">
          <TableHead className="bg-gray-75">
            <tr>
              <TableHeaderCell className="px-5 py-3.5">이름</TableHeaderCell>
              <TableHeaderCell className="py-3.5">이메일</TableHeaderCell>
              <TableHeaderCell className="py-3.5">부서</TableHeaderCell>
              <TableHeaderCell className="py-3.5 text-center">역할</TableHeaderCell>
              <TableHeaderCell className="py-3.5 text-center">상태</TableHeaderCell>
              <TableHeaderCell className="py-3.5">마지막 로그인</TableHeaderCell>
              <TableHeaderCell className="px-5 py-3.5 text-right">관리</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="px-5 font-semibold whitespace-nowrap">
                  {user.name}
                  {user.id === currentUserId ? (
                    <span className="ml-1.5 text-[11px] font-medium text-text-tertiary">(나)</span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-text-secondary">
                  {user.email}
                </TableCell>
                <TableCell className="whitespace-nowrap text-text-secondary">
                  {user.department ?? '—'}
                </TableCell>
                <TableCell className="text-center">
                  <Pill tone={user.role === 'ADMIN' ? 'purple' : 'neutral'}>{user.role}</Pill>
                </TableCell>
                <TableCell className="text-center">
                  <Pill tone={user.status === 'active' ? 'positive' : 'red'}>
                    {user.status === 'active' ? '활성' : '비활성'}
                  </Pill>
                </TableCell>
                <TableCell className="text-[12px] whitespace-nowrap text-text-tertiary">
                  {user.lastLoginAt
                    ? formatAuditTime(new Date(user.lastLoginAt))
                    : `미로그인 · ${CREATED_VIA_LABELS[user.createdVia]}`}
                </TableCell>
                <TableCell className="px-5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setForm({ kind: 'edit', user })}
                    aria-label={`${user.email} 수정`}
                    className="border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold text-purple-600 hover:underline"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    disabled={user.status === 'inactive' || user.id === currentUserId}
                    onClick={() => setConfirming(user)}
                    aria-label={`${user.email} 비활성화`}
                    className="border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold text-text-tertiary hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-text-tertiary"
                  >
                    비활성화
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Presence>
        {form ? (
          <UserFormModal
            mode={form}
            error={error}
            onClose={() => {
              setForm(null);
              setError(null);
            }}
            onDone={handleDone}
          />
        ) : null}
      </Presence>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="사용자 비활성화"
        footer={
          <>
            <Button size="sm" onClick={() => setConfirming(null)}>
              취소
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={isPending}
              onClick={() => confirming && deactivate(confirming)}
            >
              비활성화
            </Button>
          </>
        }
      >
        <p className="m-0">
          <strong className="text-ink-900">{confirming?.email}</strong> 계정을 비활성화합니다.
          로그인이 거부되고 사용 중인 세션도 최대 60초 안에 종료됩니다. 수정 화면에서 다시 활성화할
          수 있습니다.
        </p>
      </Modal>
    </>
  );
}
