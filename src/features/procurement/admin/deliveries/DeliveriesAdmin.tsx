'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition, type FormEvent } from 'react';

import { Button, Input, Segmented } from '@/components/ui';
import {
  DataTable,
  DataTableFilterEmpty,
  DataTableQuickFilterBar,
  DataTableResetButton,
  withColumnFilterParams,
  type DataTableColumn,
  type DataTableFilterField,
  type DataTableSort,
} from '@/components/ui/data-table';
import { Icon } from '@/features/shell/icons';
import { cn } from '@/lib/cn';
import { navigateView } from '@/lib/page-state/view-navigation';
import {
  adminDeliveriesHref,
  ADMIN_PROCUREMENT_PATH,
  DELIVERY_FILTER_IDS,
  DELIVERY_FILTER_LABELS,
  deliveryFilterDefs,
  isAdminDeliveriesFiltered,
  type AdminDeliveriesView,
  type DeliveryFilterChoices,
} from '@/lib/procurement/admin-deliveries-filter';
import {
  DELIVERY_NO_PRODUCT,
  DELIVERY_QUICK_FIELDS,
  DELIVERY_SORT_IDS,
  type DeliverySortId,
} from '@/lib/procurement/admin-deliveries-filter';
import {
  EMPTY_VALUE,
  formatEokMan,
  formatMillionWon,
  millionWonHeader,
} from '@/lib/procurement/format';
import type { ActionResult } from '@/lib/result';
import type { FilterCondition } from '@/lib/table/filter';
import { parseSortParams } from '@/lib/table/sort-param';
import type { DeliveryAdminRow } from '@/server/procurement/deliveries';

import { excludeDeliveryAction, restoreDeliveryAction } from './actions';
import { DeliveryConfirmModal } from './DeliveryConfirmModal';
import { DeliveryEditor, type DeliveryEditRequest } from './DeliveryEditor';
import { deliveryName, historyTime, isStaleError, quantityText } from './display';

/** 열 너비·순서 저장 키의 표 구분자 — 납품요구·휴지통은 열이 달라 따로 저장 */
export const DELIVERIES_TABLE_ID = 'procurement-admin-deliveries';
export const DELIVERIES_TRASH_TABLE_ID = 'procurement-admin-deliveries-trash';

const HEADER_CLASS = 'py-[13px] first:pl-5 last:pr-5';
const CELL_CLASS = 'px-3 py-2.5 whitespace-nowrap first:pl-5 last:pr-5';
const NUM_CLASS = 'text-[13px] text-ink-900 tabular-nums';

type Notice = { tone: 'success' | 'warn'; text: string };
type Pending = { kind: 'exclude' | 'restore'; row: DeliveryAdminRow };

type SubView = 'active' | 'trash';

const VIEW_OPTIONS = (trashCount: number) =>
  [
    { value: 'active', label: '납품요구' },
    { value: 'trash', label: trashCount > 0 ? `휴지통 ${trashCount}` : '휴지통' },
  ] as const;

function moneyCell(won: number | null) {
  // 칸 = 백만원, 툴팁 = 억·만 (D-3)
  return won === null ? (
    EMPTY_VALUE
  ) : (
    <span title={formatEokMan(won)}>{formatMillionWon(won)}</span>
  );
}

function textColumn(
  id: DeliverySortId,
  header: string,
  value: (row: DeliveryAdminRow) => string | null,
  cellClass = 'text-[13px] text-ink-900',
): DataTableColumn<DeliveryAdminRow> {
  return {
    id,
    header,
    label: header,
    type: 'text',
    headerClassName: HEADER_CLASS,
    cellClassName: cn(CELL_CLASS, cellClass),
    cell: (row) => value(row) ?? EMPTY_VALUE,
  };
}

function numberColumn(
  id: DeliverySortId,
  header: string,
  label: string,
  cell: (row: DeliveryAdminRow) => React.ReactNode,
): DataTableColumn<DeliveryAdminRow> {
  return {
    id,
    header,
    label,
    type: 'number',
    align: 'right',
    headerClassName: HEADER_CLASS,
    cellClassName: cn(CELL_CLASS, NUM_CLASS),
    cell,
  };
}

const DATE_COLUMN = textColumn(
  'dlvrReqDate',
  '납품요구일자',
  (row) => row.dlvrReqDate,
  'text-[12px] text-text-tertiary tabular-nums',
);
const PRODUCT_COLUMN = textColumn(
  'product',
  '제품',
  (row) => row.product ?? DELIVERY_NO_PRODUCT,
  'text-[13px] font-semibold text-ink-900',
);
const ORG_COLUMN = textColumn('demandOrg', '수요기관', (row) => row.demandOrg);
const VENDOR_COLUMN = textColumn('vendor', '납품업체', (row) => row.vendor);
const ITEM_ID_COLUMN = textColumn(
  'itemId',
  '물품식별번호',
  (row) => row.itemId,
  'text-[12px] text-text-tertiary tabular-nums',
);
const ITEM_NAME_COLUMN = textColumn('itemName', '물품식별명', (row) => row.itemName);
const QUANTITY_COLUMN = numberColumn('quantity', '수량', '수량', (row) =>
  quantityText(row.quantity),
);
const UNIT_PRICE_COLUMN = numberColumn(
  'unitPrice',
  millionWonHeader('계약단가'),
  '계약단가',
  (row) => moneyCell(row.unitPrice),
);
const AMOUNT_COLUMN = numberColumn('amount', millionWonHeader('납품금액'), '납품금액', (row) =>
  moneyCell(row.amount),
);

/** 표 열 (납품요구 = 원본 실적 목록 칸, 휴지통 = 삭제 시각·삭제한 사람 + 주요 칸). 관리 열은 끝에 고정 */
function deliveryColumns(
  trash: boolean,
  actions: {
    edit: (row: DeliveryAdminRow) => void;
    exclude: (row: DeliveryAdminRow) => void;
    restore: (row: DeliveryAdminRow) => void;
  },
): DataTableColumn<DeliveryAdminRow>[] {
  const manage: DataTableColumn<DeliveryAdminRow> = {
    id: 'manage',
    header: '관리',
    label: '관리',
    type: 'none',
    pinned: 'end',
    resizable: false,
    headerClassName: HEADER_CLASS,
    cellClassName: cn(CELL_CLASS, 'text-right'),
    cell: (row) =>
      trash ? (
        <Button
          size="sm"
          variant="primary"
          aria-label={`${deliveryName(row)} 되살리기`}
          onClick={() => actions.restore(row)}
        >
          되살리기
        </Button>
      ) : (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            aria-label={`${deliveryName(row)} 편집`}
            onClick={() => actions.edit(row)}
          >
            편집
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${deliveryName(row)} 휴지통으로`}
            onClick={() => actions.exclude(row)}
          >
            휴지통으로
          </Button>
        </div>
      ),
  };
  if (trash) {
    return [
      {
        id: 'excludedAt',
        header: '삭제 시각',
        label: '삭제 시각',
        type: 'date',
        headerClassName: HEADER_CLASS,
        cellClassName: cn(CELL_CLASS, 'text-[12px] text-text-secondary tabular-nums'),
        cell: (row) => (row.excludedAt ? historyTime(row.excludedAt) : EMPTY_VALUE),
      },
      {
        id: 'excludedBy',
        header: '삭제한 사람',
        label: '삭제한 사람',
        type: 'text',
        sortable: false,
        headerClassName: HEADER_CLASS,
        cellClassName: cn(CELL_CLASS, 'text-[12px] text-text-secondary'),
        cell: (row) => row.excludedBy ?? EMPTY_VALUE,
      },
      DATE_COLUMN,
      PRODUCT_COLUMN,
      ORG_COLUMN,
      VENDOR_COLUMN,
      ITEM_ID_COLUMN,
      ITEM_NAME_COLUMN,
      AMOUNT_COLUMN,
      manage,
    ];
  }
  return [
    DATE_COLUMN,
    PRODUCT_COLUMN,
    ORG_COLUMN,
    VENDOR_COLUMN,
    ITEM_ID_COLUMN,
    ITEM_NAME_COLUMN,
    QUANTITY_COLUMN,
    UNIT_PRICE_COLUMN,
    AMOUNT_COLUMN,
    manage,
  ];
}

const NO_VALUE = () => null;

/** 빠른 필터 바 필드 (서버 표 — value 접근자는 쓰지 않는다). 고정 = 납품요구일자·제품·납품업체 */
function deliveryFilterFields(
  choices: DeliveryFilterChoices,
): DataTableFilterField<DeliveryAdminRow>[] {
  const defs = deliveryFilterDefs(choices);
  return DELIVERY_FILTER_IDS.map((id) => ({
    id,
    label: DELIVERY_FILTER_LABELS[id],
    filter: defs[id],
    value: NO_VALUE,
    ...(DELIVERY_QUICK_FIELDS.includes(id) ? { quick: true } : {}),
  }));
}

/** 표 헤더 정렬 → URL 정렬 (화이트리스트 파서를 그대로 거친다) */
function urlSort(next: DataTableSort) {
  return parseSortParams(next ? { sort: next.id, dir: next.dir } : {}, DELIVERY_SORT_IDS);
}

export type DeliveriesAdminProps = {
  rows: readonly DeliveryAdminRow[];
  /** 현재 URL 상태 (하위 화면·검색·열 필터·정렬·페이지 — 범위를 넘은 page 는 서버가 맞춘 값) */
  view: AdminDeliveriesView;
  total: number;
  pageCount: number;
  trashCount: number;
  /** 제품·납품업체 선택지 (서버 facets — 그 하위 화면 전체 기준) */
  choices: DeliveryFilterChoices;
  /** 열 너비·순서 저장 키 */
  userId: string;
};

/**
 * 조달 관리 · 실적 관리 탭 (조달이 통합 UI-6, procurement.write = ADMIN). 데이터는 RSC 섹션(DeliveriesAdminSection)이 URL 로 읽어 준다.
 * - 납품요구 표: 서버 정렬·필터·페이지네이션(브라우저는 한 페이지 50행만 받는다), 빠른 필터 바(server 모드)·검색. URL 이 상태다 —
 *   열 필터·검색 = router.replace(1페이지), 정렬·페이지·하위 화면 = push (뒤로 가기·공유 링크·조회 상태 기억).
 * - 편집: 드로어(전 필드 + 변경 이력 10건) → 확인 모달 → 저장. 휴지통으로·되살리기: 확인 모달. 쓰기 뒤 router.refresh().
 * - 휴지통 하위 화면(`trash=1`): 삭제 시각·삭제한 사람(이력의 마지막 휴지통 기록) + 되살리기.
 * - 모든 쓰기는 서버에서 이력(delivery_changes)·감사(audit_logs)를 같은 트랜잭션에 남긴다. "이미 처리됨"이면 안내 후 새로 고친다.
 */
export function DeliveriesAdmin({
  rows,
  view,
  total,
  pageCount,
  trashCount,
  choices,
  userId,
}: DeliveriesAdminProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<DeliveryEditRequest | null>(null);

  const go = (next: Partial<AdminDeliveriesView>, history: 'push' | 'replace' = 'push') =>
    navigateView(adminDeliveriesHref(next), (href) =>
      startTransition(() => (history === 'replace' ? router.replace(href) : router.push(href))),
    );
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const stale = useCallback(() => {
    setEditing(null);
    setPending(null);
    setNotice({
      tone: 'warn',
      text: '이미 처리됨 — 다른 사람이 먼저 바꿨습니다. 최신 내용으로 새로 고쳤습니다.',
    });
    refresh();
  }, [refresh]);

  const subView: SubView = view.trash ? 'trash' : 'active';
  const columns = useMemo(
    () =>
      deliveryColumns(view.trash, {
        edit: (row) => setEditing((current) => ({ id: row.id, seq: (current?.seq ?? 0) + 1 })),
        exclude: (row) => setPending({ kind: 'exclude', row }),
        restore: (row) => setPending({ kind: 'restore', row }),
      }),
    [view.trash],
  );
  const fields = useMemo(() => deliveryFilterFields(choices), [choices]);
  const filters = useMemo(() => view.filters ?? [], [view.filters]);
  const filtered = isAdminDeliveriesFiltered(view);
  const tableId = view.trash ? DELIVERIES_TRASH_TABLE_ID : DELIVERIES_TABLE_ID;

  const changeView = (next: SubView) => {
    setNotice(null);
    go({ trash: next === 'trash', page: 1 });
  };
  const changeFilters = (next: readonly FilterCondition[]) =>
    go({ ...view, filters: [...next], page: 1 }, 'replace');
  const changeSort = (next: DataTableSort) => go({ ...view, sort: urlSort(next), page: 1 });
  // '필터 초기화' = 열 필터 + 검색 + 정렬 (하위 화면은 유지)
  const resetFilters = () => go({ trash: view.trash, page: 1 });
  const search = (q: string | undefined) => go({ ...view, q, page: 1 }, 'replace');

  const actionDone = (result: ActionResult<unknown>, text: string): boolean => {
    if (result.ok) {
      setPending(null);
      setNotice({ tone: 'success', text });
      refresh();
      return true;
    }
    if (isStaleError(result.error)) {
      stale();
      return true;
    }
    return false;
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="max-w-full overflow-x-auto">
        <Segmented
          aria-label="실적 관리 보기"
          options={VIEW_OPTIONS(trashCount)}
          value={subView}
          onChange={changeView}
          className="w-fit"
        />
      </div>
      {notice ? (
        <p
          role={notice.tone === 'warn' ? 'alert' : 'status'}
          className={cn(
            'm-0 rounded-lg px-4 py-2.5 text-[13px]',
            notice.tone === 'warn'
              ? 'bg-accent-orange/10 text-ink-900'
              : 'bg-gray-75 text-text-secondary',
          )}
        >
          {notice.text}
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <DataTableQuickFilterBar
          className="w-full min-w-0 xl:w-auto xl:flex-1"
          mode="server"
          label={view.trash ? '휴지통 필터' : '납품요구 필터'}
          fields={fields}
          filters={filters}
          onFiltersChange={changeFilters}
          onReset={resetFilters}
          sorted={view.sort !== undefined}
          canReset={filtered || view.sort !== undefined}
          total={total}
          pending={isPending}
          flush={{ path: ADMIN_PROCUREMENT_PATH, apply: withColumnFilterParams }}
          leading={
            // 검색어 입력은 로컬 상태 — 초기화·뒤로 가기 등으로 q 가 바뀌면 새로 그려 입력값을 URL 과 맞춘다
            <DeliveriesSearch
              key={`${subView}:${view.q ?? ''}`}
              initial={view.q ?? ''}
              onSearch={search}
            />
          }
        />
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          <DataTableResetButton tableId={tableId} userId={userId} columns={columns} />
        </div>
      </div>
      {/* 표는 이 상자 안에서만 가로 스크롤 — 320px 에서도 페이지 가로 스크롤 없음 */}
      <div
        data-procurement-deliveries-scroll=""
        className="max-w-full overflow-x-auto rounded-[10px] bg-surface-card shadow-(--hairline-default)"
        aria-busy={isPending || undefined}
      >
        <DataTable
          key={subView}
          tableId={tableId}
          userId={userId}
          columns={columns}
          rows={rows}
          getRowKey={(row) => String(row.id)}
          sortMode="server"
          sort={view.sort ?? null}
          onSortChange={changeSort}
          filters={filters}
          filteredTotal={total}
          aria-label={view.trash ? '휴지통 표' : '납품요구 표'}
          headClassName="bg-gray-75"
        />
        {rows.length === 0 ? (
          filtered ? (
            <DataTableFilterEmpty onReset={resetFilters} />
          ) : (
            <p role="status" className="m-0 p-12 text-center text-[13px] text-text-tertiary">
              {view.trash
                ? '휴지통이 비어 있어요. 삭제한 납품요구는 여기로 옮겨지고, 언제든 되살릴 수 있어요.'
                : '납품요구가 없습니다.'}
            </p>
          )
        ) : null}
      </div>
      {pageCount > 1 ? (
        <DeliveriesPagination
          page={view.page}
          pageCount={pageCount}
          total={total}
          onPage={(page) => go({ ...view, page })}
        />
      ) : null}

      <DeliveryEditor
        request={editing}
        onClose={() => setEditing(null)}
        onSaved={(changed) => {
          setEditing(null);
          setNotice({ tone: 'success', text: `저장했습니다 (${changed}개 칸).` });
          refresh();
        }}
        onStale={stale}
      />
      {pending?.kind === 'exclude' ? (
        <DeliveryConfirmModal
          title="휴지통으로 옮기기"
          confirmLabel="휴지통으로"
          variant="danger"
          action={() => excludeDeliveryAction({ id: pending.row.id })}
          onDone={(result) =>
            actionDone(result, `${deliveryName(pending.row)} 을(를) 휴지통으로 옮겼습니다.`)
          }
          onClose={() => setPending(null)}
        >
          <p className="m-0">
            <strong className="text-ink-900">{deliveryName(pending.row)}</strong> (
            {pending.row.itemName ?? pending.row.itemId}) 납품요구를 휴지통으로 옮길까요? 조달
            통계에서 빠지고, 휴지통에서 언제든 되살릴 수 있어요.
          </p>
        </DeliveryConfirmModal>
      ) : null}
      {pending?.kind === 'restore' ? (
        <DeliveryConfirmModal
          title="되살리기"
          confirmLabel="되살리기"
          action={() => restoreDeliveryAction({ id: pending.row.id })}
          onDone={(result) =>
            actionDone(result, `${deliveryName(pending.row)} 을(를) 되살렸습니다.`)
          }
          onClose={() => setPending(null)}
        >
          <p className="m-0">
            <strong className="text-ink-900">{deliveryName(pending.row)}</strong> (
            {pending.row.itemName ?? pending.row.itemId}) 납품요구를 되살릴까요? 다시 조달 통계에
            반영돼요.
          </p>
        </DeliveryConfirmModal>
      ) : null}
    </div>
  );
}

/** 납품요구번호·물품식별번호·물품식별명·수요기관·사업명 검색 — 제출 시 적용 */
function DeliveriesSearch({
  initial,
  onSearch,
}: {
  initial: string;
  onSearch: (q: string | undefined) => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(value.trim() || undefined);
  };
  return (
    <form
      role="search"
      aria-label="납품요구 검색"
      onSubmit={submit}
      className="w-full sm:w-[320px]"
    >
      <Input
        type="search"
        name="q"
        aria-label="납품요구번호·물품식별번호·물품명·수요기관 검색"
        value={value}
        placeholder="납품요구번호, 물품, 수요기관으로 검색"
        onChange={(event) => setValue(event.target.value)}
        leading={<Icon name="search" className="size-4" />}
        className="bg-surface-card"
      />
    </form>
  );
}

/** 이전/다음 + 현재 위치 (서버 페이지네이션) */
function DeliveriesPagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <nav
      aria-label="페이지"
      className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-tertiary"
    >
      <span className="tabular-nums">
        총 {total.toLocaleString('ko-KR')}건 · {page} / {pageCount} 페이지
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          이전
        </Button>
        <Button size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          다음
        </Button>
      </div>
    </nav>
  );
}
