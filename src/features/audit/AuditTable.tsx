'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useTransition } from 'react';

import { Pill } from '@/components/ui';
import {
  DataTable,
  DataTableFilterEmpty,
  DataTableQuickFilterBar,
  DataTableResetButton,
  isColumnFilterParam,
  QUICK_FILTER_FIELDS,
  replaceFilterParams,
  withQuickFields,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/data-table';
import { navigateView } from '@/lib/page-state/view-navigation';
import type { FilterCondition } from '@/lib/table/filter';
import { parseSortParams } from '@/lib/table/sort-param';
import {
  AUDIT_RESULT_LABELS,
  formatAuditTarget,
  formatAuditTime,
  summarizeJson,
  type AuditDisplayRow,
} from '@/lib/audit-format';

import {
  auditConditions,
  auditFilterFields,
  auditFilterFromConditions,
  filterToQuery,
  isAuditFiltered,
  type AuditFilter,
} from './filter';
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
  /** 행위 열 필터 선택지 (데이터에 있는 행위, listAuditActions) */
  actions?: readonly string[];
  /** 필터 결과 전체 건수 (서버) — 라이브 영역 "필터 적용 · M건". 기본: 현재 페이지 행 수 */
  total?: number;
  /** 열 너비·순서 저장 키 (#32 스펙 §5) */
  userId: string;
};

const NO_ACTIONS: readonly string[] = [];

/** 별칭 열 필터 파라미터(일시·행위·사용자 포함 — features/audit/filter) */
const ALIAS_PARAMS = new Set(['from', 'to', 'action', 'actor']);
const isAuditFilterParam = (key: string) => ALIAS_PARAMS.has(key) || isColumnFilterParam(key);

/** 디바운스 중인 조건 flush (빠른 필터 바 §6 #7) — href 의 별칭·f.* 를 next 로 바꾼다(같은 filterToQuery 인코딩) */
function withAuditFilterParams(href: string, next: readonly FilterCondition[]): string {
  const query = filterToQuery({ ...auditFilterFromConditions(next), page: 1 });
  return replaceFilterParams(href, isAuditFilterParam, [...new URLSearchParams(query.slice(1))]);
}

/**
 * 감사 로그 표 — 공용 DataTable 서버 정렬 모드 (#32 PR-3) + 열 필터 (표 열 필터 스펙 §2.4: 기존 GET 폼을 흡수).
 * 일시·행위·사용자 조건은 기존 파라미터(from·to·action·actor)에 기록한다(별칭, features/audit/filter).
 * 툴바의 '열 초기화'(너비·순서)는 '필터 초기화' 와 별개.
 */
export function AuditTable({
  rows,
  filter,
  actions = NO_ACTIONS,
  total = rows.length,
  userId,
}: AuditTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // 열 필터 변경은 replace(즉시 적용이 뒤로 가기 기록을 쌓지 않게 — 빠른 필터 바 §2.3), 정렬·초기화는 현행 push
  const go = (next: Partial<AuditFilter>, history: 'push' | 'replace' = 'push') =>
    navigateView(`${AUDIT_PATH}${filterToQuery(next)}`, (href) =>
      startTransition(() => (history === 'replace' ? router.replace(href) : router.push(href))),
    );

  const changeSort = (next: DataTableSort) =>
    go({ ...filter, sort: urlSort(next, AUDIT_SORT_IDS), page: 1 });

  // URL 에 있는데 선택지에 없는 행위(예: 아직 기록이 없는 행위)도 체크 상태로 보이게 선택지에 더한다
  const actionKey = (filter.action ?? []).join(',');
  const filterFields = useMemo(() => {
    const extra = actionKey ? actionKey.split(',').filter((a) => !actions.includes(a)) : [];
    // 고정 필드 = 일시·사용자·행위·결과 (빠른 필터 바 §2.2)
    return withQuickFields(auditFilterFields([...actions, ...extra]), QUICK_FILTER_FIELDS.audit);
  }, [actions, actionKey]);
  const conditions = useMemo(() => auditConditions(filter), [filter]);
  const changeFilters = (next: readonly FilterCondition[]) =>
    go({ ...filter, ...auditFilterFromConditions(next), page: 1 }, 'replace');
  // '필터 초기화' = 열 필터(기간·행위·사용자 포함) + 정렬 (§2.5-4)
  const resetFilters = () => go({ page: 1 });
  const filtered = isAuditFiltered(filter);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <DataTableQuickFilterBar
          className="min-w-0 flex-1"
          mode="server"
          fields={filterFields}
          filters={conditions}
          onFiltersChange={changeFilters}
          onReset={resetFilters}
          sorted={filter.sort !== undefined}
          total={total}
          pending={isPending}
          flush={{ path: AUDIT_PATH, apply: withAuditFilterParams }}
        />
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
          filters={conditions}
          filteredTotal={total}
          aria-label="감사 로그"
          headClassName="bg-gray-75"
          rowClassName={() => 'text-[12px]'}
          empty={
            filtered ? (
              <DataTableFilterEmpty onReset={resetFilters} />
            ) : (
              <div className="py-7 text-center text-[13px] text-text-tertiary">
                기록된 감사 로그가 없습니다.
              </div>
            )
          }
        />
      </div>
    </div>
  );
}
