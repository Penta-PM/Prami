'use client';

import { useMemo, type ReactNode } from 'react';

import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
  type SortType,
} from '@/components/ui/data-table';
import { cn } from '@/lib/cn';
import { priceLabel, priceTypeLabel } from '@/lib/pricing/format';
import { operationYearsLabel, periodLabel } from '@/lib/pricing/period';

import { ItemStatusPill, OperationStatus } from './cells';
import { columnsFor, PRICE_TABLE_IDS, type PriceColumnKey, type TableMode } from './columns';
import type { PriceRowView } from './types';

type PriceTableProps = {
  mode: TableMode;
  rows: readonly PriceRowView[];
  /** 열 너비·순서 저장 키에 넣어 다른 계정과 섞이지 않게 한다 (#32 스펙 §5) */
  userId: string;
  /** URL 의 현재 정렬 (서버 정렬, #32 스펙 §3). 없으면 기본 정렬 */
  sort?: DataTableSort;
  onSortChange?: (next: DataTableSort) => void;
  onRowClick: (row: PriceRowView) => void;
  /** 관리 표의 `관리` 칸 (수정·복사·삭제) */
  renderActions?: (row: PriceRowView) => ReactNode;
};

const COLUMN_TYPES: Record<PriceColumnKey, SortType> = {
  priceType: 'text',
  major: 'text',
  mid: 'text',
  minor: 'text',
  itemName: 'text',
  price: 'number',
  effectiveFrom: 'date',
  period: 'date',
  operationYears: 'number',
  itemStatus: 'status',
  status: 'status',
  remark: 'text',
  actions: 'none',
};

const HEADER_CLASS = 'py-[13px] first:pl-4 last:pr-4';
const CELL_CLASS =
  'px-3 py-3.5 text-[12px] whitespace-nowrap text-text-secondary first:pl-4 last:pr-4';

function cellContent(key: PriceColumnKey, row: PriceRowView): ReactNode {
  switch (key) {
    case 'priceType':
      return priceTypeLabel(row.priceType);
    case 'major':
      return row.major;
    case 'mid':
      return row.mid ?? '—';
    case 'minor':
      return row.minor ?? '—';
    case 'itemName':
      return (
        <span title={row.itemCode}>
          {row.itemName}
          <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">{row.itemCode}</span>
        </span>
      );
    case 'price':
      return priceLabel(row.unitPrice, row.currency);
    case 'effectiveFrom':
      return row.effectiveFrom;
    case 'period':
      return periodLabel(row.effectiveFrom, row.effectiveTo);
    case 'operationYears':
      return operationYearsLabel(row.effectiveFrom, row.effectiveTo);
    case 'itemStatus':
      return <ItemStatusPill status={row.itemStatus} />;
    case 'status':
      return <OperationStatus status={row.operationStatus} />;
    case 'remark':
      return row.remark ?? '';
    case 'actions':
      return null;
  }
}

const EMPHASIS: Partial<Record<PriceColumnKey, string>> = {
  itemName: 'font-semibold text-ink-900 text-[13px]',
  price: 'font-semibold text-ink-900 text-[13px]',
  period: 'text-text-tertiary',
  effectiveFrom: 'text-text-tertiary',
  operationYears: 'text-text-tertiary',
  remark: 'text-text-tertiary whitespace-normal',
};

/**
 * 가격정책 표 (디자인 조회·관리 표). 행 클릭 → 행 상세 드로어.
 * 공용 DataTable 서버 정렬 모드 (#32 PR-3) — 헤더 클릭은 onSortChange 로만 알리고(행 클릭으로 번지지 않음),
 * 정렬은 서버가 한다. 관리 칸은 정렬·재배치하지 않고 끝에 고정한다.
 */
export function PriceTable({
  mode,
  rows,
  userId,
  sort = null,
  onSortChange,
  onRowClick,
  renderActions,
}: PriceTableProps) {
  // 열 배열은 저장 레이아웃 정규화의 기준이라 렌더마다 새로 만들지 않는다
  const columns = useMemo<DataTableColumn<PriceRowView>[]>(
    () =>
      columnsFor(mode).map((column) => ({
        id: column.key,
        header: column.label,
        type: COLUMN_TYPES[column.key],
        pinned: column.pinned,
        align: column.align,
        headerClassName: HEADER_CLASS,
        cellClassName: cn(CELL_CLASS, EMPHASIS[column.key]),
        cell:
          column.key === 'actions'
            ? // 관리 칸(type none) 클릭은 DataTable 이 행 클릭으로 보내지 않는다
              (row: PriceRowView) => renderActions?.(row)
            : (row: PriceRowView) => cellContent(column.key, row),
      })),
    [mode, renderActions],
  );

  return (
    <div className="overflow-x-auto rounded-[10px] bg-surface-card shadow-(--hairline-default)">
      <DataTable
        tableId={PRICE_TABLE_IDS[mode]}
        userId={userId}
        columns={columns}
        rows={rows}
        getRowKey={(row) => String(row.id)}
        sortMode="server"
        sort={sort}
        onSortChange={onSortChange}
        aria-label={mode === 'admin' ? '가격정책 관리 표' : '가격정책 표'}
        headClassName="bg-gray-75"
        rowClassName={() => 'cursor-pointer'}
        onRowClick={onRowClick}
      />
      {rows.length === 0 ? (
        <div className="p-12 text-center text-[13px] text-text-tertiary">검색 결과가 없습니다.</div>
      ) : null}
    </div>
  );
}
