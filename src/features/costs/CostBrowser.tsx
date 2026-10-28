'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type ReactNode } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import {
  DataTable,
  DataTableFilterEmpty,
  DataTableQuickFilterBar,
  DataTableResetButton,
  QUICK_FILTER_FIELDS,
  withColumnFilterParams,
  withMoneyRanges,
  withQuickFields,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/data-table';
import { navigateView } from '@/lib/page-state/view-navigation';
import type { FilterCondition } from '@/lib/table/filter';
import type { MoneyRange } from '@/lib/table/money-range';
import { parseSortParams } from '@/lib/table/sort-param';
import { OperationStatus } from '@/features/pricing/cells';
import { cn } from '@/lib/cn';
import { priceLabel } from '@/lib/pricing/format';
import { periodLabel } from '@/lib/pricing/period';

import { CostCreateModal } from './CostCreateModal';
import { CostDeleteModal } from './CostDeleteModal';
import { CostEditModal } from './CostEditModal';
import { costFilterFields } from './column-filters';
import { costFilterToQuery, isCostFiltered } from './query';
import { COST_SORT_IDS } from './sort';
import type { CostFilterView, CostRowView } from './types';

/** 표 헤더의 정렬 → URL 정렬. 화이트리스트 파서를 그대로 거쳐 허용된 id 만 남긴다 (#32 스펙 §3) */
function urlSort<Id extends string>(next: DataTableSort, allowed: readonly Id[]) {
  return parseSortParams(next ? { sort: next.id, dir: next.dir } : {}, allowed);
}

/**
 * 원가 표 컬럼 (디자인 원가 관리 표, §4.5.5). 셋째 열은 셀이 `row.unit` 이라 헤더도 '단위' (#32 Q3 A).
 * 정렬 가능한 열의 id 는 서버 정렬 화이트리스트(COST_SORT_IDS)와 같다. 관리 열은 정렬·재배치하지 않고 끝에 고정.
 */
export const COST_COLUMNS = [
  { key: 'code', label: '원자재 코드', align: 'left', type: 'text' },
  { key: 'name', label: '원자재명', align: 'left', type: 'text' },
  { key: 'unit', label: '단위', align: 'left', type: 'text' },
  { key: 'cost', label: '원가', align: 'right', type: 'number' },
  { key: 'effectiveFrom', label: '적용시작일', align: 'left', type: 'date' },
  { key: 'period', label: '적용기간', align: 'center', type: 'date' },
  { key: 'status', label: '상태', align: 'center', type: 'status' },
  { key: 'actions', label: '관리', align: 'right', type: 'none' },
] as const;

type CostColumnKey = (typeof COST_COLUMNS)[number]['key'];

/** 열 너비·순서 저장 키의 표 구분자 (#32 스펙 §5) */
const COSTS_TABLE_ID = 'costs';
const COSTS_PATH = '/admin/costs';

const ACTION = 'border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold hover:underline';
const HEADER_CLASS = 'py-[13px] first:pl-5 last:pr-5';
const CELL_CLASS = 'px-3 py-3.5 whitespace-nowrap first:pl-5 last:pr-5';

const CELL_CLASSES: Record<CostColumnKey, string> = {
  code: 'text-[12px] text-text-tertiary',
  name: 'text-[14px] font-semibold text-text-primary',
  unit: 'text-[14px] text-text-secondary',
  cost: 'text-[14px] font-semibold text-text-primary',
  effectiveFrom: 'text-[12px] text-text-tertiary',
  period: 'text-[12px] text-text-tertiary',
  status: '',
  actions: '',
};

type Flash = { tone: 'ok' | 'error'; text: string };

type CostBrowserProps = {
  rows: readonly CostRowView[];
  /** 현재 URL 필터 — 정렬을 바꾸면 이 필터 그대로 sort/dir 만 바꾸고 1페이지로 간다 (#32 스펙 §3) */
  filter: CostFilterView;
  /** 필터 결과 전체 건수 (서버) — 라이브 영역 "필터 적용 · M건". 기본: 현재 페이지 행 수 */
  total?: number;
  /** 통화 열 필터 선택지 (데이터에 있는 통화 코드) */
  currencies?: readonly string[];
  /**
   * 원가 슬라이더 범위 — 통화별 표 전체 최소·최대 (서버 listCostCurrencyRanges, cost.read — 빠른 필터 바 §7.5).
   * 원가 화면 props 로만 내려온다(공용 필드 정의·가격 화면에는 없다). 없으면 슬라이더 대신 문구
   */
  costRanges?: readonly MoneyRange[];
  /** 열 너비·순서 저장 키 (#32 스펙 §5) */
  userId: string;
  /** 기존 페이지 필터(제품군 탭·기간·검색 — CostFilters). 빠른 필터 바와 같은 카드 안, 바 위 (빠른 필터 바 §2.5) */
  leading?: ReactNode;
};

const NO_CURRENCIES: readonly string[] = [];

/** 원가 표 + 수정/삭제 모달 (ADMIN). 원가 값은 이 화면에만 노출된다 */
export function CostBrowser({
  rows,
  filter,
  total = rows.length,
  currencies = NO_CURRENCIES,
  costRanges,
  userId,
  leading,
}: CostBrowserProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CostRowView | null>(null);
  const [deleting, setDeleting] = useState<CostRowView | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  const done = (text: string) => {
    setCreating(false);
    setEditing(null);
    setDeleting(null);
    setFlash({ tone: 'ok', text });
    router.refresh();
  };

  const columns = useMemo(() => costColumns({ onEdit: setEditing, onDelete: setDeleting }), []);

  // 열 필터 변경은 replace(즉시 적용이 뒤로 가기 기록을 쌓지 않게 — 빠른 필터 바 §2.3), 정렬·초기화는 현행 push
  const go = (next: Partial<CostFilterView>, history: 'push' | 'replace' = 'push') =>
    navigateView(`${COSTS_PATH}${costFilterToQuery(next)}`, (href) =>
      startTransition(() => (history === 'replace' ? router.replace(href) : router.push(href))),
    );

  const changeSort = (next: DataTableSort) =>
    go({ ...filter, sort: urlSort(next, COST_SORT_IDS), page: 1 });

  // 열 필터 (표 열 필터 스펙 §2) — 기존 필터·정렬은 그대로, 1페이지로. 고정 필드 = 통화·원가·상태 (빠른 필터 바 §2.2)
  const filterFields = useMemo(() => {
    const fields = withQuickFields(costFilterFields(currencies), QUICK_FILTER_FIELDS.costs);
    return costRanges ? withMoneyRanges(fields, 'cost', costRanges) : fields;
  }, [currencies, costRanges]);
  const columnFilters = filter.filters ?? [];
  const changeFilters = (next: readonly FilterCondition[]) =>
    go({ ...filter, filters: [...next], page: 1 }, 'replace');
  // '필터 초기화' = 열 필터 + 기간·검색 + 정렬 (§2.5-4, Plan Q1 B). 제품군 탭은 화면 이동이라 유지 (§7 Q5)
  const resetFilters = () => go({ family: filter.family, dateMode: 'start', page: 1 });
  const filtered = isCostFiltered(filter);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <DataTableQuickFilterBar
          className="w-full min-w-0 xl:w-auto xl:flex-1"
          mode="server"
          fields={filterFields}
          filters={columnFilters}
          onFiltersChange={changeFilters}
          onReset={resetFilters}
          sorted={filter.sort !== undefined}
          canReset={filtered || filter.sort !== undefined}
          total={total}
          pending={isPending}
          flush={{ path: COSTS_PATH, apply: withColumnFilterParams }}
          leading={leading}
        />
        {/* 바 옆 버튼 묶음 — 좁으면 다른 줄로(§7.1 A3) */}
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          <DataTableResetButton tableId={COSTS_TABLE_ID} userId={userId} columns={columns} />
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            + 등록
          </Button>
        </div>
      </div>
      {/* 등록·수정·삭제 결과 — 페이지 필터·바 카드 아래(가격 관리와 같은 위치) */}
      <Presence>
        {flash ? (
          <Collapse key="flash" role={flash.tone === 'error' ? 'alert' : 'status'}>
            <p
              className={cn(
                'm-0 rounded-lg px-3.5 py-2.5 text-[14px]',
                flash.tone === 'error'
                  ? 'bg-surface-danger text-text-danger'
                  : 'bg-success-50 text-success-700',
              )}
            >
              {flash.text}
            </p>
          </Collapse>
        ) : null}
      </Presence>
      <div className="overflow-x-auto rounded-[10px] bg-surface-card shadow-(--hairline-default)">
        <DataTable
          tableId={COSTS_TABLE_ID}
          userId={userId}
          columns={columns}
          rows={rows}
          getRowKey={(row) => String(row.id)}
          sortMode="server"
          sort={filter.sort ?? null}
          onSortChange={changeSort}
          filters={columnFilters}
          filteredTotal={total}
          aria-label="원가 표"
          headClassName="bg-surface-muted"
        />
        {rows.length === 0 ? (
          filtered ? (
            <DataTableFilterEmpty onReset={resetFilters} />
          ) : (
            <div className="p-12 text-center text-[14px] text-text-tertiary">
              등록된 원가가 없습니다.
            </div>
          )
        ) : null}
      </div>
      <Presence>
        {creating ? <CostCreateModal onClose={() => setCreating(false)} onSaved={done} /> : null}
      </Presence>
      <Presence>
        {editing ? (
          <CostEditModal row={editing} onClose={() => setEditing(null)} onSaved={done} />
        ) : null}
      </Presence>
      <Presence>
        {deleting ? (
          <CostDeleteModal row={deleting} onClose={() => setDeleting(null)} onDeleted={done} />
        ) : null}
      </Presence>
    </div>
  );
}

type RowHandlers = {
  onEdit: (row: CostRowView) => void;
  onDelete: (row: CostRowView) => void;
};

function cellContent(key: CostColumnKey, row: CostRowView, handlers: RowHandlers): ReactNode {
  switch (key) {
    case 'code':
      return row.materialCode;
    case 'name':
      return (
        <>
          {row.materialName}
          {row.source === 'manual' ? (
            <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">수동</span>
          ) : null}
        </>
      );
    case 'unit':
      return row.unit;
    case 'cost':
      return priceLabel(row.unitCost, row.currency);
    case 'effectiveFrom':
      return row.effectiveFrom;
    case 'period':
      return periodLabel(row.effectiveFrom, row.effectiveTo);
    case 'status':
      return <OperationStatus status={row.operationStatus} />;
    case 'actions':
      return (
        <>
          <button
            type="button"
            aria-label={`${row.materialName} 수정`}
            className={`${ACTION} text-link hover:text-link-hover`}
            onClick={() => handlers.onEdit(row)}
          >
            수정
          </button>
          <button
            type="button"
            aria-label={`${row.materialName} 삭제`}
            className={`${ACTION} text-text-danger`}
            onClick={() => handlers.onDelete(row)}
          >
            삭제
          </button>
        </>
      );
  }
}

/** DataTable 열 정의 (서버 정렬). 관리 열은 type 'none' + 끝 고정 */
function costColumns(handlers: RowHandlers): DataTableColumn<CostRowView>[] {
  return COST_COLUMNS.map((column) => ({
    id: column.key,
    header: column.label,
    type: column.type,
    align: column.align,
    pinned: column.key === 'actions' ? ('end' as const) : undefined,
    headerClassName: HEADER_CLASS,
    cellClassName: cn(CELL_CLASS, CELL_CLASSES[column.key]),
    cell: (row: CostRowView) => cellContent(column.key, row, handlers),
  }));
}
