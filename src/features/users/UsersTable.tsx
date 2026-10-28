'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Modal, Pill } from '@/components/ui';
import {
  DataTable,
  DataTableFilterEmpty,
  DataTableQuickFilterBar,
  DataTableResetButton,
  filterDefsOf,
  filterFieldsOf,
  QUICK_FILTER_FIELDS,
  useUrlTableState,
  withQuickFields,
  type DataTableColumn,
} from '@/components/ui/data-table';
import { formatAuditTime } from '@/lib/audit-format';
import type { ActionResult } from '@/lib/result';
import { STATUS_ORDERS } from '@/lib/table/compare';

import { deactivateUserAction } from './actions';
import { USER_STATUS_LABELS, USERS_FILTER_DEFS, USERS_SORT_IDS } from './table-state';
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

/** 열 너비·순서 저장 키의 표 구분자 (#32 스펙 §5) */
const USERS_TABLE_ID = 'users';

const STATUS_LABELS: Record<UserRow['status'], string> = USER_STATUS_LABELS;

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

  // 열 배열은 저장 레이아웃 정규화의 기준이라 렌더마다 새로 만들지 않는다
  const columns = useMemo<DataTableColumn<UserRow>[]>(
    () => [
      {
        id: 'name',
        header: '이름',
        type: 'text',
        sortValue: (user) => user.name,
        filter: USERS_FILTER_DEFS.name,
        headerClassName: 'px-5 py-3.5',
        cellClassName: 'px-5 font-semibold whitespace-nowrap',
        cell: (user) => (
          <>
            {user.name}
            {user.id === currentUserId ? (
              <span className="ml-1.5 text-[11px] font-medium text-text-tertiary">(나)</span>
            ) : null}
          </>
        ),
      },
      {
        id: 'email',
        header: '이메일',
        type: 'text',
        sortValue: (user) => user.email,
        filter: USERS_FILTER_DEFS.email,
        headerClassName: 'py-3.5',
        cellClassName: 'whitespace-nowrap text-text-secondary',
        cell: (user) => user.email,
      },
      {
        id: 'department',
        header: '부서',
        type: 'text',
        sortValue: (user) => user.department,
        filter: USERS_FILTER_DEFS.department,
        headerClassName: 'py-3.5',
        cellClassName: 'whitespace-nowrap text-text-secondary',
        cell: (user) => user.department ?? '—',
      },
      {
        id: 'role',
        header: '역할',
        type: 'status',
        statusOrder: STATUS_ORDERS.role,
        sortValue: (user) => user.role,
        filter: USERS_FILTER_DEFS.role,
        align: 'center',
        headerClassName: 'py-3.5',
        cell: (user) => (
          <Pill tone={user.role === 'ADMIN' ? 'purple' : 'neutral'}>{user.role}</Pill>
        ),
      },
      {
        id: 'status',
        header: '상태',
        type: 'status',
        statusOrder: STATUS_ORDERS.userStatus,
        sortValue: (user) => user.status,
        filter: USERS_FILTER_DEFS.status,
        align: 'center',
        headerClassName: 'py-3.5',
        cell: (user) => (
          <Pill tone={user.status === 'active' ? 'positive' : 'red'}>
            {STATUS_LABELS[user.status]}
          </Pill>
        ),
      },
      {
        id: 'lastLoginAt',
        header: '마지막 로그인',
        type: 'date',
        // 미로그인은 빈 값 → 방향과 관계없이 맨 뒤
        sortValue: (user) => user.lastLoginAt,
        // KST 날짜로 비교 (미로그인은 빈 값 → 기간 조건에 맞지 않음)
        filter: USERS_FILTER_DEFS.lastLoginAt,
        headerClassName: 'py-3.5',
        cellClassName: 'text-[12px] whitespace-nowrap text-text-tertiary',
        cell: (user) =>
          user.lastLoginAt
            ? formatAuditTime(new Date(user.lastLoginAt))
            : `미로그인 · ${CREATED_VIA_LABELS[user.createdVia]}`,
      },
      {
        id: 'actions',
        header: '관리',
        type: 'none',
        pinned: 'end',
        align: 'right',
        headerClassName: 'px-5 py-3.5',
        cellClassName: 'px-5 whitespace-nowrap',
        cell: (user) => (
          <>
            <button
              type="button"
              onClick={() => setForm({ kind: 'edit', user })}
              aria-label={`${user.email} 수정`}
              className="border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold text-link hover:text-link-hover hover:underline"
            >
              수정
            </button>
            <button
              type="button"
              disabled={user.status === 'inactive' || user.id === currentUserId}
              onClick={() => setConfirming(user)}
              aria-label={`${user.email} 비활성화`}
              className="border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold text-text-tertiary hover:text-text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-text-tertiary"
            >
              비활성화
            </button>
          </>
        ),
      },
    ],
    [currentUserId],
  );

  // 빠른 필터 바 고정 필드: 이름·부서·역할·상태 (＋ 더: 이메일·마지막 로그인)
  const filterFields = useMemo(
    () => withQuickFields(filterFieldsOf(columns), QUICK_FILTER_FIELDS.users),
    [columns],
  );
  const filterDefs = useMemo(() => filterDefsOf(filterFields), [filterFields]);
  // 열 필터·정렬은 URL 상태 (page-state-memory §2.2-6 — #32 §5 개정). '필터 초기화' 는 둘을 한 번에 해제
  const {
    filters,
    setFilters,
    sort,
    setSort,
    reset: resetFilters,
  } = useUrlTableState(filterDefs, USERS_SORT_IDS);

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          사용자 · 권한 관리
        </h1>
        <div className="flex items-center gap-2">
          <DataTableResetButton tableId={USERS_TABLE_ID} userId={currentUserId} columns={columns} />
          <Button variant="primary" size="sm" onClick={() => setForm({ kind: 'create' })}>
            + 사용자 추가
          </Button>
        </div>
      </div>

      <Presence>
        {error && !form ? (
          <Collapse key="error" role="alert">
            <p className="m-0 mb-4 rounded-lg bg-surface-danger px-3.5 py-3 text-[14px] text-text-danger">
              {error}
            </p>
          </Collapse>
        ) : null}
      </Presence>

      <DataTableQuickFilterBar
        className="mb-3"
        fields={filterFields}
        filters={filters}
        onFiltersChange={setFilters}
        onReset={resetFilters}
        sorted={sort !== null}
        rows={users}
      />

      <div className="overflow-hidden rounded-[10px] bg-surface-card shadow-(--hairline-default)">
        <DataTable
          tableId={USERS_TABLE_ID}
          userId={currentUserId}
          columns={columns}
          rows={users}
          getRowKey={(user) => user.id}
          aria-label="사용자 목록"
          headClassName="bg-surface-muted"
          sort={sort}
          onSortChange={setSort}
          filters={filters}
          filterFields={filterFields}
          empty={users.length > 0 ? <DataTableFilterEmpty onReset={resetFilters} /> : undefined}
        />
        {users.length === 0 ? (
          <p className="m-0 p-12 text-center text-[14px] text-text-tertiary">
            등록된 사용자가 없습니다.
          </p>
        ) : null}
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
            <Button onClick={() => setConfirming(null)}>취소</Button>
            <Button
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
          <strong className="text-text-primary">{confirming?.email}</strong> 계정을 비활성화합니다.
          로그인이 거부되고 사용 중인 세션도 최대 60초 안에 종료됩니다. 수정 화면에서 다시 활성화할
          수 있습니다.
        </p>
      </Modal>
    </>
  );
}
