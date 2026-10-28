'use client';

import { useMemo, type ReactNode } from 'react';

import {
  DataTable,
  DataTableFilterEmpty,
  type DataTableColumn,
  type DataTableSort,
  type SortType,
} from '@/components/ui/data-table';
import { cn } from '@/lib/cn';
import type { FilterCondition } from '@/lib/table/filter';
import { priceLabel, priceTypeLabel } from '@/lib/pricing/format';
import { operationYearsLabel, periodLabel } from '@/lib/pricing/period';

import {
  CostLink,
  CostLinkButton,
  costLinkEditable,
  CostRatio,
  ItemStatusPill,
  OperationStatus,
  PriceChange,
  PriceChangeButton,
} from './cells';
import { columnsFor, PRICE_TABLE_IDS, type PriceColumnKey, type TableMode } from './columns';
import type { CostLinkCellView, CostRatioView, PriceRowView } from './types';

type PriceTableProps = {
  mode: TableMode;
  rows: readonly PriceRowView[];
  /** 열 너비·순서 저장 키에 넣어 다른 계정과 섞이지 않게 한다 (#32 스펙 §5) */
  userId: string;
  /** URL 의 현재 정렬 (서버 정렬, #32 스펙 §3). 없으면 기본 정렬 */
  sort?: DataTableSort;
  onSortChange?: (next: DataTableSort) => void;
  /** 열 필터 조건 (URL) — 헤더 점 표시·라이브 영역. 행은 이미 서버가 거른 결과 */
  filters?: readonly FilterCondition[];
  /** 필터 결과 전체 건수 (서버) */
  total?: number;
  /** 기존 필터·열 필터가 걸렸는가 — 0건일 때 "조건에 맞는 결과가 없습니다" + [필터 초기화] (§2.5-7) */
  filtered?: boolean;
  onResetFilters?: () => void;
  onRowClick: (row: PriceRowView) => void;
  /** 관리 표의 `관리` 칸 (수정·복사·삭제) */
  renderActions?: (row: PriceRowView) => ReactNode;
  /**
   * 원가 비중 (관리 표 + cost.read, cost-ratio-price-change §2.3). 없으면 열 자체가 없다.
   * 현재 페이지 행만, 대상이 아닌 행은 키가 없다(칸 '—')
   */
  costRatios?: Readonly<Record<number, CostRatioView>>;
  /**
   * 원가 매핑 칸 (policy-cost-link-column §2.1) — 품목코드 → 값. 원가 비중과 같은 판정(costRatios 가 있을 때만 열이 있다).
   * 실패 등으로 값이 없는 품목은 칸 '—'
   */
  costLinks?: Readonly<Record<string, CostLinkCellView>>;
  /** 원가 매핑 칸 클릭 → 매핑 수정 모달 (cost.write 일 때만 넘긴다 — 없으면 칸은 텍스트만). 안정된 참조로 넘긴다 */
  onCostLink?: (row: PriceRowView) => void;
  /**
   * 가격 변동 칸 클릭 → 변동 이력 모달 (price-change-history-modal §2.2). 있으면 칸이 버튼이 되고 행 클릭으로 번지지 않는다.
   * 열 배열을 다시 만들지 않도록 안정된 참조(useCallback)로 넘긴다
   */
  onPriceHistory?: (row: PriceRowView) => void;
  /**
   * 가격 변동 열 (pricing-view-hide-price-change §1) — 관리 표 + pricing.write(서버 판정)일 때만 true.
   * 조회 표는 값과 관계없이 열 정의가 없다
   */
  withPriceChange?: boolean;
};

const COLUMN_TYPES: Record<PriceColumnKey, SortType> = {
  priceType: 'text',
  major: 'text',
  mid: 'text',
  minor: 'text',
  itemName: 'text',
  price: 'number',
  // 정렬·열 필터 없음(policy-cost-link-column §2.1-3) — 아래 열 정의에서 sortable: false
  costLink: 'text',
  // 1차는 정렬 불가(§2.3-4) — 아래 열 정의에서 sortable: false
  costRatio: 'number',
  effectiveFrom: 'date',
  period: 'date',
  operationYears: 'number',
  priceChange: 'number',
  itemStatus: 'status',
  status: 'status',
  remark: 'text',
  actions: 'none',
};

const HEADER_CLASS = 'py-[13px] first:pl-4 last:pr-4';
const CELL_CLASS =
  'px-3 py-3.5 text-[12px] whitespace-nowrap text-text-secondary first:pl-4 last:pr-4';

type CellOptions = {
  costRatios: Readonly<Record<number, CostRatioView>> | undefined;
  costLinks: Readonly<Record<string, CostLinkCellView>> | undefined;
  onPriceHistory: ((row: PriceRowView) => void) | undefined;
  onCostLink: ((row: PriceRowView) => void) | undefined;
};

function cellContent(
  key: PriceColumnKey,
  row: PriceRowView,
  { costRatios, costLinks, onPriceHistory, onCostLink }: CellOptions,
): ReactNode {
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
    case 'costLink': {
      const value = costLinks?.[row.itemCode];
      if (onCostLink && costLinkEditable(value)) {
        return (
          <CostLinkButton
            rowId={row.id}
            itemName={row.itemName}
            value={value}
            onOpen={() => onCostLink(row)}
          />
        );
      }
      return <CostLink value={value} />;
    }
    case 'costRatio':
      return <CostRatio value={costRatios?.[row.id]} />;
    case 'effectiveFrom':
      return row.effectiveFrom;
    case 'period':
      return periodLabel(row.effectiveFrom, row.effectiveTo);
    case 'operationYears':
      return operationYearsLabel(row.effectiveFrom, row.effectiveTo);
    case 'priceChange':
      if (onPriceHistory) return <PriceChangeButton row={row} onOpen={() => onPriceHistory(row)} />;
      return (
        <PriceChange
          unitPrice={row.unitPrice}
          previousPrice={row.previousPrice ?? null}
          rate={row.priceChangeRate ?? null}
        />
      );
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
  itemName: 'font-semibold text-text-primary text-[14px]',
  price: 'font-semibold text-text-primary text-[14px]',
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
  filters,
  total,
  filtered = false,
  onResetFilters,
  onRowClick,
  renderActions,
  costRatios,
  costLinks,
  onCostLink,
  onPriceHistory,
  withPriceChange = false,
}: PriceTableProps) {
  const withCost = mode === 'admin' && costRatios !== undefined;
  const withChange = mode === 'admin' && withPriceChange;
  // 열 배열은 저장 레이아웃 정규화의 기준이라 렌더마다 새로 만들지 않는다
  const columns = useMemo<DataTableColumn<PriceRowView>[]>(
    () =>
      columnsFor(mode, withCost, withChange).map((column) => ({
        id: column.key,
        header: column.label,
        type: COLUMN_TYPES[column.key],
        pinned: column.pinned,
        align: column.align,
        headerClassName: HEADER_CLASS,
        // 원가 비중: 1차 정렬 불가(sort=costRatio 는 서버 화이트리스트 밖 — 기본 정렬), 최소 폭 72px, 헤더 줄바꿈 금지(§2.3)
        ...(column.key === 'costRatio'
          ? {
              sortable: false,
              minWidth: 72,
              headerClassName: cn(HEADER_CLASS, 'whitespace-nowrap'),
            }
          : column.key === 'costLink'
            ? // 원가 매핑: 정렬·열 필터 없음(sort=costLink·f.costLink.* 는 서버 화이트리스트 밖 — 무시), 최소 폭 120px
              {
                sortable: false,
                minWidth: 120,
                headerClassName: cn(HEADER_CLASS, 'whitespace-nowrap'),
              }
            : {}),
        cellClassName: cn(CELL_CLASS, EMPHASIS[column.key]),
        cell:
          column.key === 'actions'
            ? // 관리 칸(type none) 클릭은 DataTable 이 행 클릭으로 보내지 않는다
              (row: PriceRowView) => renderActions?.(row)
            : (row: PriceRowView) =>
                cellContent(column.key, row, {
                  costRatios,
                  costLinks,
                  onPriceHistory: withChange ? onPriceHistory : undefined,
                  onCostLink: withCost ? onCostLink : undefined,
                }),
      })),
    // costRatios·costLinks 는 서버가 새 페이지를 보낼 때만 바뀐다(rows 와 같은 시점) — 열 id 는 그대로라 레이아웃 정규화에 영향 없음
    [mode, withCost, withChange, renderActions, costRatios, costLinks, onPriceHistory, onCostLink],
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
        filters={filters}
        filteredTotal={total}
        aria-label={mode === 'admin' ? '가격정책 관리 표' : '가격정책 표'}
        headClassName="bg-surface-muted"
        rowClassName={() => 'cursor-pointer'}
        onRowClick={onRowClick}
      />
      {rows.length === 0 ? (
        filtered && onResetFilters ? (
          <DataTableFilterEmpty onReset={onResetFilters} />
        ) : (
          <div className="p-12 text-center text-[14px] text-text-tertiary">
            등록된 가격정책이 없습니다.
          </div>
        )
      ) : null}
    </div>
  );
}
