'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { Input } from '@/components/ui';
import {
  DataTable,
  DataTableFilterEmpty,
  DataTableQuickFilterBar,
  DataTableResetButton,
  withColumnFilterParams,
  withMoneyRanges,
  withQuickFields,
  type DataTableColumn,
  type DataTableFilterField,
  type DataTableSort,
} from '@/components/ui/data-table';
import { Icon } from '@/features/shell/icons';
import { cn } from '@/lib/cn';
import { navigateView } from '@/lib/page-state/view-navigation';
import {
  EMPTY_VALUE,
  formatEokMan,
  formatMillionWon,
  millionWonHeader,
} from '@/lib/procurement/format';
import { isOurManufacturer } from '@/lib/procurement/our-company';
import type { FilterCondition } from '@/lib/table/filter';
import type { MoneyRange } from '@/lib/table/money-range';
import { parseSortParams } from '@/lib/table/sort-param';

import {
  ITEM_FILTER_IDS,
  ITEM_FILTER_LABELS,
  ITEM_QUICK_FIELDS,
  ITEM_SORT_IDS,
  itemFilterDefs,
  itemsViewToQuery,
  isItemsFiltered,
  PROCUREMENT_ITEMS_PATH,
  type ItemFilterChoices,
  type ItemFilterId,
  type ItemsView,
} from './filter';
import type { ItemRowView } from './types';

/** 열 너비·순서 저장 키의 표 구분자 (#32 스펙 §5) */
export const ITEMS_TABLE_ID = 'procurement-items';

/** 자사 행 강조 (--accent-ours 8% 틴트, hover 12% — 글자 대비는 globals.css 주석). 색 외에 "자사" 배지를 함께 둔다 */
export const OURS_ROW_CLASS = 'bg-accent-ours/8 hover:bg-accent-ours/12';

const HEADER_CLASS = 'py-[13px] first:pl-5 last:pr-5';
const CELL_CLASS = 'px-3 py-3 whitespace-nowrap first:pl-5 last:pr-5';

type ColumnKey = (typeof ITEM_SORT_IDS)[number];

const COLUMNS: readonly {
  key: ColumnKey;
  label: string;
  header: string;
  align: 'left' | 'right';
  type: DataTableColumn<ItemRowView>['type'];
  cellClass: string;
}[] = [
  {
    key: 'registeredOn',
    label: '등록일자',
    header: '등록일자',
    align: 'left',
    type: 'date',
    cellClass: 'text-[12px] text-text-tertiary tabular-nums',
  },
  {
    key: 'product',
    label: '제품',
    header: '제품',
    align: 'left',
    type: 'text',
    cellClass: 'text-[13px] font-semibold text-ink-900',
  },
  {
    key: 'detailCategory',
    label: '세부분류',
    header: '세부분류',
    align: 'left',
    type: 'text',
    cellClass: 'text-[13px] text-text-secondary',
  },
  {
    key: 'manufacturer',
    label: '제조사',
    header: '제조사',
    align: 'left',
    type: 'text',
    cellClass: 'text-[13px] text-ink-900',
  },
  {
    key: 'itemId',
    label: '물품식별번호',
    header: '물품식별번호',
    align: 'left',
    type: 'text',
    cellClass: 'text-[12px] text-text-tertiary tabular-nums',
  },
  {
    key: 'itemName',
    label: '품목명',
    header: '품목명',
    align: 'left',
    type: 'text',
    cellClass: 'text-[13px] text-ink-900',
  },
  {
    key: 'unitPrice',
    label: '계약단가',
    // 표 금액 = 백만원 소수 1자리, 단위는 머리글에 한 번 (D-3)
    header: millionWonHeader('계약단가'),
    align: 'right',
    type: 'number',
    cellClass: 'text-[13px] font-semibold text-ink-900 tabular-nums',
  },
];

function OursBadge() {
  return (
    <span className="ml-1.5 inline-flex items-center rounded-md px-1.5 py-0.5 align-middle text-[11px] font-semibold text-accent-ours shadow-[inset_0_0_0_1px_var(--accent-ours)]">
      자사
    </span>
  );
}

function cellContent(key: ColumnKey, row: ItemRowView): ReactNode {
  switch (key) {
    case 'registeredOn':
      return row.registeredOn ?? EMPTY_VALUE;
    case 'product':
      return row.product;
    case 'detailCategory':
      return row.detailCategory ?? EMPTY_VALUE;
    case 'manufacturer':
      return (
        <>
          {row.manufacturer ?? EMPTY_VALUE}
          {isOurManufacturer(row.manufacturer) ? <OursBadge /> : null}
        </>
      );
    case 'itemId':
      return row.itemId;
    case 'itemName':
      return row.itemName ?? EMPTY_VALUE;
    case 'unitPrice':
      // 칸 = 백만원, 툴팁 = 억·만 (D-3)
      return row.unitPrice === null ? (
        EMPTY_VALUE
      ) : (
        <span title={formatEokMan(row.unitPrice)}>{formatMillionWon(row.unitPrice)}</span>
      );
  }
}

/** DataTable 열 정의 (서버 정렬 — 열 id = 정렬 화이트리스트) */
export function itemColumns(): DataTableColumn<ItemRowView>[] {
  return COLUMNS.map((column) => ({
    id: column.key,
    header: column.header,
    label: column.label,
    type: column.type,
    align: column.align,
    headerClassName: HEADER_CLASS,
    cellClassName: cn(CELL_CLASS, column.cellClass),
    cell: (row: ItemRowView) => cellContent(column.key, row),
  }));
}

const NO_VALUE = () => null;

/**
 * 빠른 필터 바 필드 (서버 표 — value 접근자는 쓰지 않는다). 고정 = 제품·세부분류·제조사, 계약단가는 로그 눈금 슬라이더
 * (범위 = 등록 품목 전체의 계약단가 최소·최대, KRW — 통화가 하나라 통화 선택 단계가 없다).
 * 계약단가가 하나도 없으면(범위 없음) 고를 수 없으므로 계약단가 필드를 빼되, URL 에 이미 걸린 조건은 읽고 풀 수 있게 남긴다.
 */
export function itemFilterFields(
  choices: ItemFilterChoices,
  priceRange: MoneyRange | undefined,
  filters: readonly FilterCondition[] = [],
): DataTableFilterField<ItemRowView>[] {
  const defs = itemFilterDefs(choices);
  const priceActive = filters.some((cond) => cond.col === 'unitPrice');
  const fields = ITEM_FILTER_IDS.filter(
    (id) => id !== 'unitPrice' || priceRange !== undefined || priceActive,
  ).map((id: ItemFilterId) => ({
    id,
    label: ITEM_FILTER_LABELS[id],
    filter: defs[id],
    value: NO_VALUE,
  }));
  const quick = withQuickFields(fields, ITEM_QUICK_FIELDS);
  return priceRange ? withMoneyRanges(quick, 'unitPrice', [priceRange]) : quick;
}

/** 표 헤더 정렬 → URL 정렬 (화이트리스트 파서를 그대로 거친다) */
function urlSort(next: DataTableSort) {
  return parseSortParams(next ? { sort: next.id, dir: next.dir } : {}, ITEM_SORT_IDS);
}

export type ItemsBrowserProps = {
  rows: readonly ItemRowView[];
  /** 현재 URL 상태 (검색·열 필터·정렬·페이지) */
  view: ItemsView;
  /** 필터 결과 전체 건수 (서버) */
  total: number;
  /** 제품·세부분류·제조사 선택지 (서버 facets — 등록 품목 전체 기준) */
  choices: ItemFilterChoices;
  /** 계약단가 슬라이더 범위 (서버 getProcurementItemPriceRange, KRW). 단가가 하나도 없으면 undefined */
  priceRange?: MoneyRange;
  /** 열 너비·순서 저장 키 */
  userId: string;
};

/**
 * 등록 품목 표 (조달이 통합 UI-2). 서버 정렬·필터·페이지네이션 — 브라우저는 한 페이지(기본 50행)만 받는다.
 * 열 필터 변경·검색은 router.replace(뒤로 가기 기록을 쌓지 않음 — 빠른 필터 바 §2.3), 정렬·페이지·초기화는 push. URL 이 상태다.
 * 자사 제조사 행은 --accent-ours 로 강조하고 "자사" 배지를 단다(isOurManufacturer — 색만으로 구분하지 않음).
 */
export function ItemsBrowser({
  rows,
  view,
  total,
  choices,
  priceRange,
  userId,
}: ItemsBrowserProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const columns = useMemo(() => itemColumns(), []);
  const go = (next: Partial<ItemsView>, history: 'push' | 'replace' = 'push') =>
    navigateView(`${PROCUREMENT_ITEMS_PATH}${itemsViewToQuery(next)}`, (href) =>
      startTransition(() => (history === 'replace' ? router.replace(href) : router.push(href))),
    );

  const filters = useMemo(() => view.filters ?? [], [view.filters]);
  const fields = useMemo(
    () => itemFilterFields(choices, priceRange, filters),
    [choices, priceRange, filters],
  );
  const changeFilters = (next: readonly FilterCondition[]) =>
    go({ ...view, filters: [...next], page: 1 }, 'replace');
  const changeSort = (next: DataTableSort) => go({ ...view, sort: urlSort(next), page: 1 });
  // '필터 초기화' = 열 필터 + 검색 + 정렬
  const resetFilters = () => go({ page: 1 });
  const search = (q: string | undefined) => go({ ...view, q, page: 1 }, 'replace');
  const filtered = isItemsFiltered(view);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <DataTableQuickFilterBar
          className="w-full min-w-0 xl:w-auto xl:flex-1"
          mode="server"
          label="등록 품목 필터"
          fields={fields}
          filters={filters}
          onFiltersChange={changeFilters}
          onReset={resetFilters}
          sorted={view.sort !== undefined}
          canReset={filtered || view.sort !== undefined}
          total={total}
          pending={isPending}
          flush={{ path: PROCUREMENT_ITEMS_PATH, apply: withColumnFilterParams }}
          leading={
            // 검색어 입력은 로컬 상태 — 초기화·뒤로 가기 등으로 q 가 바뀌면 새로 그려 입력값을 URL 과 맞춘다
            <ItemsSearch key={view.q ?? ''} initial={view.q ?? ''} onSearch={search} />
          }
        />
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          <DataTableResetButton tableId={ITEMS_TABLE_ID} userId={userId} columns={columns} />
        </div>
      </div>
      {/* 표는 이 상자 안에서만 가로 스크롤 — 320px 에서도 페이지 가로 스크롤 없음 */}
      <div
        data-procurement-items-scroll=""
        className="max-w-full overflow-x-auto rounded-[10px] bg-surface-card shadow-(--hairline-default)"
        aria-busy={isPending || undefined}
      >
        <DataTable
          tableId={ITEMS_TABLE_ID}
          userId={userId}
          columns={columns}
          rows={rows}
          getRowKey={(row) => String(row.id)}
          sortMode="server"
          sort={view.sort ?? null}
          onSortChange={changeSort}
          filters={filters}
          filteredTotal={total}
          rowClassName={(row) => (isOurManufacturer(row.manufacturer) ? OURS_ROW_CLASS : undefined)}
          aria-label="등록 품목 표"
          headClassName="bg-gray-75"
        />
        {rows.length === 0 ? (
          filtered ? (
            <DataTableFilterEmpty onReset={resetFilters} />
          ) : (
            <p role="status" className="m-0 p-12 text-center text-[13px] text-text-tertiary">
              등록된 품목이 없습니다.
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}

/** 물품식별번호·품목명 검색 (페이지 필터 `q`, 바 위) — 제출 시 적용 */
function ItemsSearch({
  initial,
  onSearch,
}: {
  initial: string;
  onSearch: (q: string | undefined) => void;
}) {
  const [query, setQuery] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(query.trim() || undefined);
  };
  return (
    <form
      role="search"
      aria-label="등록 품목 검색"
      onSubmit={submit}
      className="w-full sm:w-[300px]"
    >
      <Input
        type="search"
        name="q"
        aria-label="물품식별번호·품목명 검색"
        value={query}
        placeholder="물품식별번호, 품목명으로 검색"
        onChange={(event) => setQuery(event.target.value)}
        leading={<Icon name="search" className="size-4" />}
        className="bg-surface-card"
      />
    </form>
  );
}
