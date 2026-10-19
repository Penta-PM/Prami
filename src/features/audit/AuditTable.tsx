'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Pill } from '@/components/ui';
import {
  DataTable,
  DataTableResetButton,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/data-table';
import { parseSortParams } from '@/lib/table/sort-param';
import {
  AUDIT_RESULT_LABELS,
  formatAuditTarget,
  formatAuditTime,
  summarizeJson,
  type AuditDisplayRow,
} from '@/lib/audit-format';
import type { AuditFilter } from '@/server/audit/queries';

import { filterToQuery } from './query';
import { AUDIT_SORT_IDS } from './sort';

/** 표 헤더의 정렬 → URL 정렬. 화이트리스트 파서를 그대로 거쳐 허용된 id 만 남긴다 (#32 스펙 §3) */
function urlSort<Id extends string>(next: DataTableSort, allowed: readonly Id[]) {
  return parseSortParams(next ? { sort: next.id, dir: next.dir } : {}, allowed);
}

const RESULT_TONES = { success: 'positive', denied: 'red', error: 'amber' } as const;

/** 열 너비·순서 저장 키의 표 구분자 (#32 스펙 §5) */
const AUDIT_TABLE_ID = 'audit';
const AUDIT_PATH = '/admin/audit';

const HEADER_CLASS = 'py-3.5 first:pl-4 last:pr-4';
const CELL_CLASS = 'first:pl-4 last:pr-4';

/**
 * 감사 로그 열 (디자인 열 순서: 일시·사용자·행위·대상·변경 전·변경 후·IP·결과).
 * 정렬 가능한 열의 id 는 서버 정렬 화이트리스트(AUDIT_SORT_IDS)와 같다.
 * 변경 전/후(jsonb)는 정렬하지 않지만 너비 조절·재배치는 된다 (#32 스펙 §2).
 */
const AUDIT_COLUMNS: readonly DataTableColumn<AuditDisplayRow>[] = [
  {
    id: 'createdAt',
    header: '일시',
    type: 'date',
    headerClassName: HEADER_CLASS,
    cellClassName: `${CELL_CLASS} whitespace-nowrap text-text-tertiary`,
    cell: (row) => formatAuditTime(row.createdAt),
  },
  {
    id: 'actor',
    header: '사용자',
    type: 'text',
    headerClassName: HEADER_CLASS,
    cellClassName: `${CELL_CLASS} font-medium whitespace-nowrap`,
    cell: (row) => row.actorLabel,
  },
  {
    id: 'action',
    header: '행위',
    type: 'text',
    headerClassName: HEADER_CLASS,
    cellClassName: `${CELL_CLASS} font-semibold whitespace-nowrap`,
    cell: (row) => row.action,
  },
  {
    id: 'target',
    header: '대상',
    type: 'text',
    headerClassName: HEADER_CLASS,
    cellClassName: `${CELL_CLASS} text-text-secondary`,
    cell: (row) => formatAuditTarget(row),
  },
  {
    id: 'before',
    header: '변경 전',
    type: 'text',
    sortable: false,
    headerClassName: HEADER_CLASS,
    cellClassName: `${CELL_CLASS} max-w-[220px] text-text-tertiary`,
    cell: (row) => summarizeJson(row.before) || '—',
  },
  {
    id: 'after',
    header: '변경 후',
    type: 'text',
    sortable: false,
    headerClassName: HEADER_CLASS,
    cellClassName: `${CELL_CLASS} max-w-[220px] text-text-tertiary`,
    cell: (row) => summarizeJson(row.after) || '—',
  },
  {
    id: 'ip',
    header: 'IP',
    type: 'text',
    headerClassName: HEADER_CLASS,
    cellClassName: `${CELL_CLASS} whitespace-nowrap text-text-tertiary`,
    cell: (row) => row.ip ?? '—',
  },
  {
    id: 'result',
    header: '결과',
    type: 'status',
    align: 'center',
    headerClassName: HEADER_CLASS,
    cellClassName: CELL_CLASS,
    cell: (row) => <Pill tone={RESULT_TONES[row.result]}>{AUDIT_RESULT_LABELS[row.result]}</Pill>,
  },
];

type AuditTableProps = {
  rows: readonly AuditDisplayRow[];
  /** 현재 URL 필터 — 정렬을 바꾸면 이 필터 그대로 sort/dir 만 바꾸고 1페이지로 간다 (#32 스펙 §3) */
  filter: AuditFilter;
  /** 열 너비·순서 저장 키 (#32 스펙 §5) */
  userId: string;
};

/** 감사 로그 표 — 공용 DataTable 서버 정렬 모드 (#32 PR-3). 툴바의 '열 초기화'는 필터 초기화와 별개 */
export function AuditTable({ rows, filter, userId }: AuditTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const changeSort = (next: DataTableSort) =>
    startTransition(() =>
      router.push(
        `${AUDIT_PATH}${filterToQuery({ ...filter, sort: urlSort(next, AUDIT_SORT_IDS), page: 1 })}`,
      ),
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <DataTableResetButton tableId={AUDIT_TABLE_ID} userId={userId} columns={AUDIT_COLUMNS} />
      </div>
      <div className="overflow-hidden rounded-[10px] bg-surface-card shadow-(--hairline-default)">
        <DataTable
          tableId={AUDIT_TABLE_ID}
          userId={userId}
          columns={AUDIT_COLUMNS}
          rows={rows}
          getRowKey={(row) => String(row.id)}
          sortMode="server"
          sort={filter.sort ?? null}
          onSortChange={changeSort}
          aria-label="감사 로그"
          headClassName="bg-gray-75"
          rowClassName={() => 'text-[12px]'}
          empty={
            <div className="py-7 text-center text-[13px] text-text-tertiary">
              조건에 맞는 감사 로그가 없습니다.
            </div>
          }
        />
      </div>
    </div>
  );
}
