'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import {
  DataTableQuickFilterBar,
  DataTableResetButton,
  QUICK_FILTER_FIELDS,
  withColumnFilterParams,
  withMoneyRanges,
  withQuickFields,
  type DataTableSort,
} from '@/components/ui/data-table';
import { CostLinkEditModal, type CostLinkSaved } from '@/features/costs/CostLinkEditModal';
import { navigateView } from '@/lib/page-state/view-navigation';
import type { FilterCondition } from '@/lib/table/filter';
import type { MoneyRange } from '@/lib/table/money-range';
import { parseSortParams } from '@/lib/table/sort-param';

import { getPriceRowDetailAction } from './actions';
import { priceFilterFields } from './column-filters';
import { layoutColumnsFor, PRICE_TABLE_IDS, type TableMode } from './columns';
import { DeletePolicyModal } from './DeletePolicyModal';
import { filterToQuery, isPriceFiltered, priceSortIds, type PriceFilter } from './filter';
import { EMPTY_POLICY_FORM, formFromRow, type PolicyFormValues } from './policy-form';
import { PolicyFormModal, type PolicyFormMode } from './PolicyFormModal';
import { PriceHistoryModal } from './PriceHistoryModal';
import { PriceTable } from './PriceTable';
import { RowDetailDrawer } from './RowDetailDrawer';
import type { CostLinkCellView, CostRatioView, PriceRowView } from './types';

/** 표 헤더의 정렬 → URL 정렬. 화이트리스트 파서를 그대로 거쳐 허용된 id 만 남긴다 (#32 스펙 §3) */
function urlSort<Id extends string>(next: DataTableSort, allowed: readonly Id[]) {
  return parseSortParams(next ? { sort: next.id, dir: next.dir } : {}, allowed);
}

const NO_OPTIONS: readonly string[] = [];

type FormState = { mode: PolicyFormMode; initial: PolicyFormValues; itemStatus: string | null };
type Flash = { tone: 'ok' | 'error'; text: string };

const ACTION_BUTTON =
  'border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold hover:underline';

/** 등록·수정·복사·삭제 상태 — 수정·복사는 행 상세(원본 20컬럼)를 불러와 폼을 채운다 */
function usePolicyEditing() {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<PriceRowView | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [, startTransition] = useTransition();

  const openCreate = () =>
    setForm({ mode: { kind: 'create' }, initial: EMPTY_POLICY_FORM, itemStatus: null });

  // 관리 칸 렌더러를 안정적으로 유지해 표 열 배열이 렌더마다 바뀌지 않게 한다
  const openFromRow = useCallback(
    (row: PriceRowView, kind: 'edit' | 'copy') =>
      startTransition(async () => {
        // 수정·복사는 관리 화면에서만 — 원본 값만 쓰지만 관리 화면 요청('manage')으로 보낸다
        const result = await getPriceRowDetailAction(row.id, 'manage');
        if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
        const detail = result.data.row;
        const initial = formFromRow(detail);
        setForm({
          mode:
            kind === 'edit'
              ? { kind: 'edit', id: row.id, source: detail.source }
              : { kind: 'create' },
          // 복사 = 기존 값으로 채운 "가격정책 등록" (적용시작일만 새로 입력, Q-09)
          initial: kind === 'copy' ? { ...initial, effectiveFrom: '' } : initial,
          itemStatus: detail.itemStatus,
        });
      }),
    [],
  );

  const done = (text: string) => {
    setForm(null);
    setDeleting(null);
    setFlash({ tone: 'ok', text });
    router.refresh();
  };

  return { form, setForm, deleting, setDeleting, flash, openCreate, openFromRow, done };
}

/**
 * 원가 매핑 칸 → 매핑 수정 모달 (policy-cost-link-column §2.3-7): 성공 시 모달 닫기 → router.refresh()(원가 비중·매핑 열 서버 재계산,
 * URL 필터·페이지 유지) → aria-live "P… 원가 매핑 변경 — 가격 행 N건" → 포커스를 연 칸으로. 낙관적 UI 없음.
 */
function useCostLinkEditing(costLinks: Readonly<Record<string, CostLinkCellView>> | undefined) {
  const router = useRouter();
  const [target, setTarget] = useState<{ rowId: number; itemCode: string } | null>(null);
  const [message, setMessage] = useState('');
  // 새로 고친 표에서 다시 포커스할 칸(가격 행 id) — refresh 로 칸이 다시 그려져도 같은 행의 버튼으로 돌아간다
  const refocusRef = useRef<number | null>(null);

  const open = useCallback(
    (row: PriceRowView) => setTarget({ rowId: row.id, itemCode: row.itemCode }),
    [],
  );
  const close = useCallback(() => setTarget(null), []);
  const focusTrigger = (rowId: number) => {
    const button = document.querySelector<HTMLElement>(`[data-cost-link-trigger="${rowId}"]`);
    if (button && document.activeElement !== button) button.focus();
  };

  const saved = ({ itemCode, priceRows }: { itemCode: string; priceRows: number }) => {
    const rowId = target?.rowId ?? null;
    refocusRef.current = rowId;
    setTarget(null);
    setMessage(`${itemCode} 원가 매핑 변경 — 가격 행 ${priceRows}건`);
    router.refresh();
    if (rowId !== null) focusTrigger(rowId);
  };

  // 서버가 새 값을 보내면(refresh 완료) 연 칸으로 포커스를 한 번 더 맞춘다
  useEffect(() => {
    const rowId = refocusRef.current;
    if (rowId === null) return;
    refocusRef.current = null;
    focusTrigger(rowId);
  }, [costLinks]);

  return { target, message, open, close, saved: saved as (saved: CostLinkSaved) => void };
}

/** 등록·수정·삭제 결과 배너 — `Presence` 안에서 `Collapse` 로 펼쳐지고 접힌다 (Motion 도입 스펙 §3.3 인라인 피드백) */
function FlashMessage({ flash }: { flash: Flash }) {
  const error = flash.tone === 'error';
  return (
    <Collapse role={error ? 'alert' : 'status'}>
      <p
        className={
          error
            ? 'm-0 rounded-lg bg-surface-danger px-3.5 py-2.5 text-[14px] text-text-danger'
            : 'm-0 rounded-lg bg-success-50 px-3.5 py-2.5 text-[14px] text-success-700'
        }
      >
        {flash.text}
      </p>
    </Collapse>
  );
}

type RowActionsProps = {
  row: PriceRowView;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

function RowActions({ row, onEdit, onCopy, onDelete }: RowActionsProps) {
  const buttons = [
    { label: '수정', tone: 'text-link hover:text-link-hover', onClick: onEdit },
    { label: '복사', tone: 'text-text-tertiary', onClick: onCopy },
    { label: '삭제', tone: 'text-text-danger', onClick: onDelete },
  ];
  return (
    <>
      {buttons.map(({ label, tone, onClick }) => (
        <button
          key={label}
          type="button"
          aria-label={`${row.itemName} ${label}`}
          className={`${ACTION_BUTTON} ${tone}`}
          onClick={onClick}
        >
          {label}
        </button>
      ))}
    </>
  );
}

type PricingBrowserProps = {
  mode: TableMode;
  rows: readonly PriceRowView[];
  /** 현재 URL 필터 — 정렬을 바꾸면 이 필터 그대로 sort/dir 만 바꾸고 1페이지로 간다 (#32 스펙 §3) */
  filter: PriceFilter;
  /** 필터 결과 전체 건수 (서버) — 라이브 영역 "필터 적용 · M건". 기본: 현재 페이지 행 수 */
  total?: number;
  /** 통화 열 필터 선택지 (데이터에 있는 통화 코드). 없으면 통화·판매가 범위를 고를 수 없다 */
  currencies?: readonly string[];
  /** 판매가 슬라이더 범위 — 통화별 표 전체 최소·최대 (서버 listPriceCurrencyRanges, 빠른 필터 바 §7.5). 없으면 슬라이더 대신 문구 */
  currencyRanges?: readonly MoneyRange[];
  /** 단가 유형 열 필터 선택지 (데이터 distinct, 빈 값은 PRICE_TYPE_NONE). 없으면 단가 유형을 고를 수 없다 */
  priceTypes?: readonly string[];
  /** 열 너비·순서 저장 키 (#32 스펙 §5) */
  userId: string;
  /** 관리 표 + cost.read 일 때만 — 없으면 원가 비중 열 없음 (cost-ratio-price-change §2.3) */
  costRatios?: Readonly<Record<number, CostRatioView>>;
  /** 원가 비중 계산 실패 — 원가 비중 열이 있는(cost.read) 사용자에게만 표 위 안내 (migration-apply-lan §2-3) */
  costRatioFailed?: boolean;
  /**
   * 원가 매핑 칸 (policy-cost-link-column §2.1) — 품목코드 → 값. costRatios 와 같은 판정(관리 + pricing.write + cost.read)일 때만.
   * 원가 비중 계산이 실패하면 빈 객체(칸 '—')
   */
  costLinks?: Readonly<Record<string, CostLinkCellView>>;
  /** cost.write (서버 판정) — 원가 매핑 칸이 매핑 수정 모달 버튼이 된다. 없으면 텍스트만 */
  costLinkEditable?: boolean;
  /**
   * 가격 변동 노출 (pricing-view-hide-price-change §1) — 서버가 판정(관리 화면 + pricing.write)해 넘긴다.
   * false 면 가격 변동 열·필터·정렬·셀 이력 모달·드로어 계열 이력과 "변동 이력 보기" 모두 없다
   */
  withPriceChange?: boolean;
  /**
   * 기존 페이지 필터(분류 연쇄·적용기간 기준·검색 — PricingFilters). 빠른 필터 바와 같은 카드 안, 바 위에 놓는다
   * (빠른 필터 바 §2.5 — 동작·URL·순서 무변경)
   */
  leading?: ReactNode;
};

/**
 * 표 + 행 상세 드로어 (조회), 관리 모드에서는 `+ 등록`·수정·복사·삭제까지 (§4.5.3).
 * 툴바의 '열 초기화'는 필터와 별개로 열 너비·순서만 되돌린다 (#32 스펙 §5).
 */
export function PricingBrowser({
  mode,
  rows,
  filter,
  total = rows.length,
  currencies = NO_OPTIONS,
  currencyRanges,
  priceTypes = NO_OPTIONS,
  userId,
  costRatios,
  costRatioFailed = false,
  costLinks,
  costLinkEditable = false,
  withPriceChange = false,
  leading,
}: PricingBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [detailId, setDetailId] = useState<number | null>(null);
  // 가격 변동 칸 → 변동 이력 모달 (price-change-history-modal §2.2). 드로어와 별개 상태 — 칸 클릭은 드로어를 열지 않는다
  const [historyId, setHistoryId] = useState<number | null>(null);
  const openHistory = useCallback((row: PriceRowView) => setHistoryId(row.id), []);
  const costLink = useCostLinkEditing(costLinks);
  const editing = usePolicyEditing();
  const { openFromRow, setDeleting } = editing;
  const admin = mode === 'admin';
  // 조회 화면은 값과 관계없이 가격 변동 없음 (서버가 이미 false 로 넘긴다 — 한 번 더 막는다)
  const priceChange = admin && withPriceChange;

  // 열 필터 변경은 replace(즉시 적용이 뒤로 가기 기록을 쌓지 않게 — 빠른 필터 바 §2.3), 정렬·초기화는 현행 push
  const go = (next: Partial<PriceFilter>, history: 'push' | 'replace' = 'push') =>
    navigateView(`${pathname}${filterToQuery(next)}`, (href) =>
      startTransition(() => (history === 'replace' ? router.replace(href) : router.push(href))),
    );

  const changeSort = (next: DataTableSort) =>
    go({ ...filter, sort: urlSort(next, priceSortIds(priceChange)), page: 1 });

  // 열 필터 (표 열 필터 스펙 §2) — 기존 필터·정렬은 그대로, 1페이지로. 고정 필드 = 단가 유형·상태·단가 (빠른 필터 바 §2.2)
  const filterFields = useMemo(() => {
    const fields = withQuickFields(
      priceFilterFields(currencies, priceTypes, { withPriceChange: priceChange }),
      QUICK_FILTER_FIELDS.pricing,
    );
    return currencyRanges ? withMoneyRanges(fields, 'price', currencyRanges) : fields;
  }, [currencies, currencyRanges, priceTypes, priceChange]);
  const columnFilters = filter.filters ?? [];
  const changeFilters = (next: readonly FilterCondition[]) =>
    go({ ...filter, filters: [...next], page: 1 }, 'replace');
  // '필터 초기화' = 열 필터 + 분류 연쇄·적용기간 기준·검색 + 정렬 (§2.5-4, Plan Q1 B)
  const resetFilters = () => go({ dateMode: 'start', page: 1 });
  const filtered = isPriceFiltered(filter);

  const renderActions = useCallback(
    (row: PriceRowView) => (
      <RowActions
        row={row}
        onEdit={() => openFromRow(row, 'edit')}
        onCopy={() => openFromRow(row, 'copy')}
        onDelete={() => setDeleting(row)}
      />
    ),
    [openFromRow, setDeleting],
  );

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
          flush={{ path: pathname, apply: withColumnFilterParams }}
          leading={leading}
        />
        {/* 바 옆 버튼 묶음 — 좁으면 다른 줄로(§7.1 A3) */}
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          <DataTableResetButton
            tableId={PRICE_TABLE_IDS[mode]}
            userId={userId}
            columns={layoutColumnsFor(mode, costRatios !== undefined, priceChange)}
          />
          {admin ? (
            <Button variant="primary" size="sm" onClick={editing.openCreate}>
              + 등록
            </Button>
          ) : null}
        </div>
      </div>
      <Presence>
        {editing.flash ? <FlashMessage key="flash" flash={editing.flash} /> : null}
      </Presence>
      {/* 원가 매핑 변경 안내 (policy-cost-link-column §2.3-7) — 영역은 늘 두고 문구만 바꾼다 */}
      {admin && costLinks !== undefined ? (
        <p aria-live="polite" className="sr-only" data-cost-link-live="">
          {costLink.message}
        </p>
      ) : null}
      {admin && costRatios !== undefined && costRatioFailed ? (
        <p
          role="status"
          className="m-0 rounded-lg bg-surface-danger px-4 py-2.5 text-[12px] text-text-danger"
        >
          원가 비중을 계산하지 못했습니다. 관리자에게 문의하세요.
        </p>
      ) : null}
      <PriceTable
        mode={mode}
        rows={rows}
        userId={userId}
        sort={filter.sort ?? null}
        onSortChange={changeSort}
        filters={columnFilters}
        total={total}
        filtered={filtered}
        onResetFilters={resetFilters}
        onRowClick={(row) => setDetailId(row.id)}
        renderActions={admin ? renderActions : undefined}
        costRatios={admin ? costRatios : undefined}
        costLinks={admin ? costLinks : undefined}
        onCostLink={
          admin && costLinks !== undefined && costLinkEditable ? costLink.open : undefined
        }
        withPriceChange={priceChange}
        onPriceHistory={priceChange ? openHistory : undefined}
      />
      <RowDetailDrawer rowId={detailId} onClose={() => setDetailId(null)} manage={priceChange} />
      <Presence>
        {priceChange && historyId !== null ? (
          <PriceHistoryModal key={historyId} rowId={historyId} onClose={() => setHistoryId(null)} />
        ) : null}
      </Presence>
      <Presence>
        {admin && costLinkEditable && costLink.target ? (
          <CostLinkEditModal
            key={costLink.target.rowId}
            itemCode={costLink.target.itemCode}
            onClose={costLink.close}
            onSaved={costLink.saved}
          />
        ) : null}
      </Presence>
      <Presence>
        {editing.form ? (
          <PolicyFormModal
            key={JSON.stringify(editing.form.mode)}
            mode={editing.form.mode}
            initial={editing.form.initial}
            initialItemStatus={editing.form.itemStatus}
            onClose={() => editing.setForm(null)}
            onSaved={editing.done}
          />
        ) : null}
      </Presence>
      <Presence>
        {editing.deleting ? (
          <DeletePolicyModal
            row={editing.deleting}
            onClose={() => editing.setDeleting(null)}
            onDeleted={editing.done}
          />
        ) : null}
      </Presence>
    </div>
  );
}
