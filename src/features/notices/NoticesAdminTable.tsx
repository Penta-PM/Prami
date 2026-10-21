'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import {
  DataTable,
  DataTableFilterBar,
  DataTableFilterEmpty,
  DataTableResetButton,
  filterDefsOf,
  filterFieldsOf,
  useUrlTableState,
  type DataTableColumn,
} from '@/components/ui/data-table';
import type { ActionResult } from '@/lib/result';

import { NoticeDeleteModal } from './NoticeDeleteModal';
import { NoticeFormModal, type NoticeFormMode } from './NoticeFormModal';
import { ImportantBadge } from './NoticeRows';
import { NOTICES_ADMIN_FILTER_DEFS, NOTICES_ADMIN_SORT_IDS } from './table-state';
import type { NoticeDetailView } from './types';

type NoticesAdminTableProps = {
  notices: readonly NoticeDetailView[];
  defaultAuthor: string;
  /** 열 너비·순서 저장 키를 계정별로 나눈다 (#32 스펙 §5) */
  userId: string;
};

const ACTION = 'border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold hover:underline';

/** 열 너비·순서 저장 키의 표 구분자 (#32 스펙 §5) */
const NOTICES_ADMIN_TABLE_ID = 'notices-admin';

/** '중요' 열 정렬 순서 — 중요 → 일반 (정상·우선 값이 앞, #32 스펙 §9 Q1 과 같은 원칙) */
const IMPORTANCE_ORDER = ['important', 'normal'] as const;

/** 공지사항 관리 (디자인 "공지사항 관리" 표: 제목·작성일·작성자·중요·관리 + `+ 공지 등록`), ADMIN 전용 */
export function NoticesAdminTable({ notices, defaultAuthor, userId }: NoticesAdminTableProps) {
  const router = useRouter();
  const [form, setForm] = useState<NoticeFormMode | null>(null);
  const [deleting, setDeleting] = useState<NoticeDetailView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const done = (verb: string) => (result: ActionResult<{ id: string; title: string }>) => {
    if (!result.ok) return;
    setForm(null);
    setDeleting(null);
    setFlash(`${verb}했습니다: ${result.data.title}`);
    router.refresh();
  };

  // 열 배열은 저장 레이아웃 정규화의 기준이라 렌더마다 새로 만들지 않는다 (setter 는 안정적)
  const columns = useMemo<DataTableColumn<NoticeDetailView>[]>(
    () => [
      {
        id: 'title',
        header: '제목',
        type: 'text',
        sortValue: (notice) => notice.title,
        filter: NOTICES_ADMIN_FILTER_DEFS.title,
        headerClassName: 'pl-5',
        cellClassName: 'pl-5 font-semibold',
        cell: (notice) => (
          <Link href={`/notices/${notice.id}`} className="text-ink-900">
            {notice.title}
          </Link>
        ),
      },
      {
        id: 'publishedAt',
        header: '작성일',
        type: 'date',
        // YYYY-MM-DD — 빈 값이면 방향과 관계없이 맨 뒤
        sortValue: (notice) => notice.publishedAt,
        filter: NOTICES_ADMIN_FILTER_DEFS.publishedAt,
        cellClassName: 'whitespace-nowrap text-text-tertiary',
        cell: (notice) => notice.publishedAt,
      },
      {
        id: 'authorName',
        header: '작성자',
        type: 'text',
        sortValue: (notice) => notice.authorName,
        filter: NOTICES_ADMIN_FILTER_DEFS.authorName,
        cellClassName: 'whitespace-nowrap text-text-secondary',
        cell: (notice) => notice.authorName,
      },
      {
        id: 'isImportant',
        header: '중요',
        type: 'status',
        statusOrder: IMPORTANCE_ORDER,
        // 표시용 '—' 를 쓰면 일반 공지가 빈 값으로 취급돼 내림차순이 의미가 없어진다 → 두 값 모두 정의 순서로
        sortValue: (notice) => (notice.isImportant ? 'important' : 'normal'),
        filter: NOTICES_ADMIN_FILTER_DEFS.isImportant,
        align: 'center',
        cell: (notice) => (notice.isImportant ? <ImportantBadge /> : '—'),
      },
      {
        id: 'actions',
        header: '관리',
        type: 'none',
        pinned: 'end',
        align: 'right',
        headerClassName: 'pr-5',
        cellClassName: 'pr-5 whitespace-nowrap',
        cell: (notice) => (
          <>
            <button
              type="button"
              aria-label={`${notice.title} 수정`}
              className={`${ACTION} text-purple-600`}
              onClick={() => setForm({ kind: 'edit', notice })}
            >
              수정
            </button>
            <button
              type="button"
              aria-label={`${notice.title} 삭제`}
              className={`${ACTION} text-red-600`}
              onClick={() => setDeleting(notice)}
            >
              삭제
            </button>
          </>
        ),
      },
    ],
    [],
  );

  const filterFields = useMemo(() => filterFieldsOf(columns), [columns]);
  const filterDefs = useMemo(() => filterDefsOf(filterFields), [filterFields]);
  // 열 필터·정렬은 URL 상태 (page-state-memory §2.2-6 — #32 §5 개정). '필터 초기화' 는 둘을 한 번에 해제
  const {
    filters,
    setFilters,
    sort,
    setSort,
    reset: resetFilters,
  } = useUrlTableState(filterDefs, NOTICES_ADMIN_SORT_IDS);

  return (
    <>
      <div className="mb-[18px] flex items-center justify-between">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          공지사항 관리
        </h1>
        <div className="flex items-center gap-2">
          <DataTableResetButton
            tableId={NOTICES_ADMIN_TABLE_ID}
            userId={userId}
            columns={columns}
          />
          <Button variant="primary" size="sm" onClick={() => setForm({ kind: 'create' })}>
            + 공지 등록
          </Button>
        </div>
      </div>
      <Presence>
        {flash ? (
          <Collapse key="flash" role="status">
            <p className="m-0 mb-4 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-700">
              {flash}
            </p>
          </Collapse>
        ) : null}
      </Presence>
      <DataTableFilterBar
        className="mb-3"
        fields={filterFields}
        filters={filters}
        onFiltersChange={setFilters}
        onReset={resetFilters}
        sorted={sort !== null}
        rows={notices}
      />
      <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
        <DataTable
          tableId={NOTICES_ADMIN_TABLE_ID}
          userId={userId}
          columns={columns}
          rows={notices}
          getRowKey={(notice) => notice.id}
          aria-label="공지 관리 표"
          headClassName="bg-gray-75"
          sort={sort}
          onSortChange={setSort}
          filters={filters}
          filterFields={filterFields}
          empty={notices.length > 0 ? <DataTableFilterEmpty onReset={resetFilters} /> : undefined}
        />
        {notices.length === 0 ? (
          <p className="m-0 p-12 text-center text-[13px] text-text-tertiary">
            등록된 공지가 없습니다.
          </p>
        ) : null}
      </div>
      <Presence>
        {form ? (
          <NoticeFormModal
            mode={form}
            defaultAuthor={defaultAuthor}
            onClose={() => setForm(null)}
            onDone={done(form.kind === 'edit' ? '수정' : '등록')}
          />
        ) : null}
      </Presence>
      <Presence>
        {deleting ? (
          <NoticeDeleteModal
            notice={deleting}
            onClose={() => setDeleting(null)}
            onDone={done('삭제')}
          />
        ) : null}
      </Presence>
    </>
  );
}
