'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';
import { sortRows } from '@/lib/table/compare';
import { serializeFilters, type FilterCondition } from '@/lib/table/filter';
import { MAX_COL_WIDTH, MIN_COL_WIDTH } from '@/lib/table/layout-storage';

import { densityAttrs } from '../density';
import { Table, TableBody, TableCell, TableHead, TableRow } from '../table';
import { applyFilterFields, filterFieldsOf, type DataTableFilterField } from './filter-fields';
import { reconcileSort, requestSort, sortBase, sortKey, type PendingSort } from './pending-sort';
import type { DataTableAlign, DataTableColumn, DataTableSort } from './types';
import { TABLE_RESET_EVENT, useTableLayout, type TableResetDetail } from './useTableLayout';

export type DataTableProps<T> = {
  /** 저장 키 구분자 — 같은 컴포넌트라도 화면이 다르면 다른 값(가격 조회 ≠ 가격 관리) */
  tableId: string;
  /** 저장 키에 넣어 다른 계정과 섞이지 않게 한다 */
  userId: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  getRowKey: (row: T) => string;
  /** client: 컴포넌트가 sortRows 로 정렬. server: rows 를 그대로 두고 onSortChange 로만 알린다 */
  sortMode?: 'client' | 'server';
  /** 넘기면 제어 모드 (server 모드는 필수 — URL 의 현재 정렬) */
  sort?: DataTableSort;
  onSortChange?: (next: DataTableSort) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** <table> 클래스 */
  className?: string;
  /** <thead> 클래스 (배경 등) */
  headClassName?: string;
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  /** 행이 없을 때 전체 폭 한 칸으로 보일 내용 */
  empty?: ReactNode;
  /**
   * 열 필터 조건 (표 열 필터 스펙 §2). client 모드는 정렬 전에 행을 거르고, server 모드는 rows 를 그대로 쓴다(서버가 이미 거름).
   * 조건이 걸린 열 헤더에 aria-hidden 점을 표시하고, 조건이 바뀌면 라이브 영역에 "필터 적용 · M건" 을 알린다.
   */
  filters?: readonly FilterCondition[];
  /** 필터 필드. 기본은 `filter` 가 있는 열(filterFieldsOf(columns)) — 열에 없는 필드(통화 등)를 더할 때만 넘긴다 */
  filterFields?: readonly DataTableFilterField<T>[];
  /** server 모드에서 필터 알림에 쓸 전체 건수(페이지가 아닌 총계). 없으면 rows.length */
  filteredTotal?: number;
};

/** 클릭과 드래그를 가르는 이동 거리 (#32 스펙 §5) */
const DRAG_THRESHOLD = 5;
/** 리사이즈 핸들 키보드 한 번 = 16px */
const RESIZE_STEP = 16;

const NO_FILTERS: readonly FilterCondition[] = [];

/** 필터 결과 라이브 안내 지연(ms) — 마지막 조건 변경 후 이 시간 뒤 1회 (표 열 필터 빠른 필터 바 §2.4) */
export const FILTER_ANNOUNCE_DELAY_MS = 300;

const ALIGN_CLASSES: Record<DataTableAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

type DragView = { id: string; label: string; x: number; y: number; indicatorX: number };

function columnLabel<T>(column: DataTableColumn<T>): string {
  return column.label ?? (typeof column.header === 'string' ? column.header : column.id);
}

function isSortable<T>(column: DataTableColumn<T>, sortMode: 'client' | 'server'): boolean {
  if (column.type === 'none') return false;
  return column.sortable ?? (sortMode === 'server' || column.sortValue !== undefined);
}

function isMovable<T>(column: DataTableColumn<T>): boolean {
  return column.pinned === undefined && column.reorderable !== false;
}

function clampWidth<T>(column: DataTableColumn<T>, width: number): number {
  const min = column.minWidth ?? MIN_COL_WIDTH;
  const max = column.maxWidth ?? MAX_COL_WIDTH;
  return Math.round(Math.min(Math.max(width, min), max));
}

/** 오름 → 내림 → 해제 순환. 다른 열을 누르면 그 열 오름차순부터 */
function nextSort(current: DataTableSort, id: string): DataTableSort {
  if (current?.id !== id) return { id, dir: 'asc' };
  return current.dir === 'asc' ? { id, dir: 'desc' } : null;
}

/** 이동 가능한 삽입 경계 [lo, hi] — 고정 열 너머로는 놓을 수 없다 */
function insertBounds<T>(ordered: readonly DataTableColumn<T>[]): [number, number] {
  const lo = ordered.filter((column) => column.pinned === 'start').length;
  const hi = ordered.length - ordered.filter((column) => column.pinned === 'end').length;
  return [lo, hi];
}

/** 필터가 걸린 열 표시 — 헤더 안에 버튼·필터 행을 두지 않는다(스펙 §2.5-3). 이름에 섞이지 않게 aria-hidden */
function FilterDot() {
  return (
    <span
      aria-hidden="true"
      data-testid="data-table-filter-dot"
      className="size-1.5 shrink-0 rounded-full bg-primary-600"
    />
  );
}

function SortIcon({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 12"
      className={cn(
        'h-3 w-2 shrink-0',
        dir ? 'text-text-primary' : 'text-text-tertiary opacity-50',
      )}
    >
      <path d="M4 1 7 5H1z" fill="currentColor" opacity={dir === 'desc' ? 0.25 : 1} />
      <path d="M4 11 1 7h6z" fill="currentColor" opacity={dir === 'asc' ? 0.25 : 1} />
    </svg>
  );
}

/**
 * 공용 표 (#32 스펙 §4·§5) — 정렬·열 너비·열 순서·키보드·저장을 직접 구현한 headless 'use client' 컴포넌트.
 * - 정렬: 헤더 <button> 클릭/Enter/Space → 오름 → 내림 → 해제. th 에 aria-sort, 아이콘은 aria-hidden.
 * - 너비: 기본은 auto 레이아웃. 처음 리사이즈할 때 모든 열의 offsetWidth 를 기준 폭으로 재고 <colgroup> + table-layout:fixed 로
 *   전환한다(기본 모습 유지). 저장되는 건 사용자가 바꾼 열의 폭뿐이고, 핸들 더블클릭은 그 열을 기준 폭으로 되돌린다.
 * - 순서: pointer 드래그(5px 이상) + 반투명 고스트 + 2px 삽입선. 행 transform/layout 애니메이션은 쓰지 않는다.
 *   키보드는 Alt+Shift+←/→. 고정 열은 움직이지 않고 그 너머로 놓을 수도 없다.
 * - 터치(pointerType 'touch')에서는 정렬만 한다.
 */
export function DataTable<T>({
  tableId,
  userId,
  columns,
  rows,
  getRowKey,
  sortMode = 'client',
  sort: sortProp,
  onSortChange,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
  headClassName,
  rowClassName,
  onRowClick,
  empty,
  filters,
  filterFields,
  filteredTotal,
}: DataTableProps<T>) {
  const domId = useId();
  const { layout, save, key: layoutKey } = useTableLayout(tableId, userId, columns);

  const byId = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);
  const ordered = useMemo(
    () =>
      layout.order
        .map((id) => byId.get(id))
        .filter((column): column is DataTableColumn<T> => column !== undefined),
    [layout.order, byId],
  );

  // ── 정렬 ────────────────────────────────────────────────────────────────
  const [innerSort, setInnerSort] = useState<DataTableSort>(null);
  const sort = sortProp !== undefined ? sortProp : innerSort;

  // ── 필터 (정렬 전) ──────────────────────────────────────────────────────
  const fields = useMemo(() => filterFields ?? filterFieldsOf(columns), [filterFields, columns]);
  const conditions = filters ?? NO_FILTERS;
  const filteredRows = useMemo(
    () => (sortMode === 'server' ? rows : applyFilterFields(rows, conditions, fields)),
    [rows, conditions, fields, sortMode],
  );
  const filteredColumns = useMemo(() => new Set(conditions.map((cond) => cond.col)), [conditions]);

  const viewRows = useMemo(() => {
    if (sortMode === 'server' || !sort) return filteredRows;
    const column = byId.get(sort.id);
    if (!column?.sortValue || !isSortable(column, sortMode)) return filteredRows;
    return sortRows(filteredRows, column.sortValue, column.type, sort.dir, column.statusOrder);
  }, [filteredRows, sort, sortMode, byId]);

  // 라이브 영역 (표당 하나)
  const [announcement, setAnnouncement] = useState('');

  // 필터 조건이 바뀌면 결과 건수를 알린다 (§2.5-6). 첫 렌더(새로고침으로 URL 에 조건이 있던 경우)는 알리지 않는다.
  // 빠른 필터 바의 즉시 적용으로 연달아 바뀌면 마지막 변경 후 FILTER_ANNOUNCE_DELAY_MS 에 1회만(빠른 필터 바 §2.4).
  // 같은 조건으로 돌아오면(A → B → A) 알리지 않는다. 문구의 건수는 알리는 시점의 최신 값
  const filterKey = useMemo(
    () =>
      serializeFilters(conditions)
        .map(([key, value]) => `${key}=${value}`)
        .join('&'),
    [conditions],
  );
  const filterCount = sortMode === 'server' ? (filteredTotal ?? rows.length) : filteredRows.length;
  const filterMessage = filterKey ? `필터 적용 · ${filterCount}건` : `필터 해제 · ${filterCount}건`;
  const filterMessageRef = useRef(filterMessage);
  useEffect(() => {
    filterMessageRef.current = filterMessage;
  }, [filterMessage]);
  const [announcedFilterKey, setAnnouncedFilterKey] = useState(filterKey);
  useEffect(() => {
    if (announcedFilterKey === filterKey) return;
    const timer = window.setTimeout(() => {
      setAnnouncedFilterKey(filterKey);
      setAnnouncement(filterMessageRef.current);
    }, FILTER_ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [filterKey, announcedFilterKey]);

  // 아직 URL(sort prop)에 반영되지 않은 정렬 요청 — 빠른 두 번 클릭이 낡은 URL 에서 계산되지 않게 (BL-2, pending-sort.ts)
  const pendingSortRef = useRef<PendingSort | null>(null);
  const currentSortKey = sortKey(sort);
  useEffect(() => {
    pendingSortRef.current = reconcileSort(pendingSortRef.current, currentSortKey);
  }, [currentSortKey]);

  const toggleSort = (column: DataTableColumn<T>) => {
    const next = nextSort(sortBase(pendingSortRef.current, sort), column.id);
    pendingSortRef.current = requestSort(pendingSortRef.current, next);
    if (sortProp === undefined) setInnerSort(next);
    onSortChange?.(next);
    const label = columnLabel(column);
    setAnnouncement(
      next ? `${label} ${next.dir === 'asc' ? '오름차순' : '내림차순'} 정렬` : `${label} 정렬 해제`,
    );
  };

  // ── 너비 ────────────────────────────────────────────────────────────────
  const thRefs = useRef(new Map<string, HTMLTableCellElement>());
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const wrapperRef = useRef<HTMLDivElement>(null);
  /** auto 레이아웃에서 잰 기준 폭. null 이면 auto 레이아웃 */
  const [baseline, setBaseline] = useState<Record<string, number> | null>(null);
  /** 포인터로 끄는 중인 폭 — 놓을 때 한 번만 저장한다 */
  const [draft, setDraft] = useState<{ id: string; width: number } | null>(null);

  const hasWidths = draft !== null || Object.keys(layout.widths).length > 0;
  const fixed = hasWidths && baseline !== null;

  const measure = useCallback(() => {
    const measured: Record<string, number> = {};
    for (const column of columns) {
      measured[column.id] = thRefs.current.get(column.id)?.offsetWidth ?? 0;
    }
    return measured;
  }, [columns]);

  // 폭이 모두 사라지면(더블클릭·열 초기화) auto 로 돌아간다 — 렌더 중 상태 보정 (이전 렌더 값에서 파생)
  if (!hasWidths && baseline !== null) setBaseline(null);

  // 저장된 폭이 있는데(새로고침 직후 등) 기준 폭이 없으면 auto 상태에서 한 번 재고 fixed 로 넘어간다.
  // 레이아웃 측정은 커밋된 DOM 이 필요해 layout effect 에서만 할 수 있고, 페인트 전에 끝나 깜빡임이 없다.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM 측정 결과 반영 (React 문서의 useLayoutEffect 측정 패턴)
    if (hasWidths && baseline === null) setBaseline(measure());
  }, [hasWidths, baseline, measure]);

  // 리사이즈 핸들(포커스 가능한 separator)의 aria-valuenow 는 필수다 — auto 레이아웃(지정 폭 없음)에서도 실제 렌더 폭을 알린다.
  // 첫 커밋 뒤와 열 폭이 바뀔 때마다(ResizeObserver) 잰다. 서버 렌더와 첫 클라이언트 렌더는 같은 값(없음)이라 하이드레이션 불일치 없음
  const [renderedWidths, setRenderedWidths] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const update = () => {
      const measured = measure();
      setRenderedWidths((prev) =>
        Object.keys(measured).every((id) => prev[id] === measured[id]) &&
        Object.keys(prev).length === Object.keys(measured).length
          ? prev
          : measured,
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    thRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [measure, layout.order]);

  // 빈 상태(결과 없음·필터 초기화)는 표가 화면보다 넓어도(320px 등) 보이는 영역 안에 둔다 (table-column-filter §2.5-7, A-1 백로그):
  // 칸 안 내용을 가로 스크롤 영역의 왼쪽에 고정(sticky)하고 폭을 스크롤 영역의 보이는 폭으로 맞춘다. 표가 화면 안에 들어가면
  // 보이는 폭 = 표 폭이라 넓은 화면의 모습은 그대로다. 서버 렌더·측정 전에는 폭 지정 없음(기존과 같음)
  const showEmpty = viewRows.length === 0 && empty !== undefined;
  const [emptyWidth, setEmptyWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!showEmpty) return;
    const scroller = wrapperRef.current?.firstElementChild;
    if (!(scroller instanceof HTMLElement)) return;
    const update = () => setEmptyWidth(scroller.clientWidth > 0 ? scroller.clientWidth : null);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [showEmpty]);

  const ensureBaseline = () => {
    if (baseline) return baseline;
    const measured = measure();
    setBaseline(measured);
    return measured;
  };

  const widthOf = (id: string): number | undefined =>
    draft?.id === id ? draft.width : (layout.widths[id] ?? baseline?.[id]);

  const commitWidth = (column: DataTableColumn<T>, width: number) => {
    save({ order: layout.order, widths: { ...layout.widths, [column.id]: width } });
    setAnnouncement(`${columnLabel(column)} 열 너비 ${width}px`);
  };

  const resetWidth = (column: DataTableColumn<T>) => {
    const widths = Object.fromEntries(
      Object.entries(layout.widths).filter(([id]) => id !== column.id),
    );
    save({ order: layout.order, widths });
    setAnnouncement(`${columnLabel(column)} 열 너비 기본값`);
  };

  // ── 순서 ────────────────────────────────────────────────────────────────
  const [dragView, setDragView] = useState<DragView | null>(null);
  /** 드래그·리사이즈 직후의 click 은 정렬하지 않는다 */
  const suppressClickRef = useRef(false);
  /** 진행 중인 포인터 상호작용의 정리 함수 (언마운트 시 리스너 해제) */
  const cleanupRef = useRef<(() => void) | null>(null);
  /** 키보드 이동 뒤 포커스를 되돌릴 헤더 */
  const pendingFocusRef = useRef<string | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  // '열 초기화' 뒤에는 버튼이 비활성화돼 포커스가 body 로 빠진다 — 첫 헤더 버튼으로 옮기고 알린다 (#32 스펙 §9 Q4)
  useEffect(() => {
    const onReset = (event: Event) => {
      if ((event as CustomEvent<TableResetDetail>).detail?.key !== layoutKey) return;
      setAnnouncement('열 너비·순서를 기본값으로 되돌렸습니다');
      // 기본 순서로 다시 그려진 뒤의 첫 헤더 버튼
      window.setTimeout(
        () => wrapperRef.current?.querySelector<HTMLButtonElement>('thead button')?.focus(),
        0,
      );
    };
    window.addEventListener(TABLE_RESET_EVENT, onReset);
    return () => window.removeEventListener(TABLE_RESET_EVENT, onReset);
  }, [layoutKey]);

  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    pendingFocusRef.current = null;
    const button = buttonRefs.current.get(id);
    if (button && document.activeElement !== button) button.focus();
  }, [layout.order]);

  const moveColumn = (column: DataTableColumn<T>, to: number) => {
    const order = layout.order.filter((id) => id !== column.id);
    order.splice(to, 0, column.id);
    save({ order, widths: layout.widths });
    setAnnouncement(`${columnLabel(column)} 열을 ${to + 1}번째로 이동`);
  };

  const suppressNextClick = () => {
    suppressClickRef.current = true;
    // click 이 오지 않는 경우(헤더 밖에서 놓음)에도 다음 클릭을 막지 않도록 다음 태스크에서 푼다
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  /** 포인터 x 에 해당하는 삽입 경계(0…n)와 2px 삽입선 위치 */
  const locateInsert = (clientX: number) => {
    const rects = ordered.map((column) => thRefs.current.get(column.id)?.getBoundingClientRect());
    let insert = 0;
    rects.forEach((rect, index) => {
      if (rect && clientX > rect.left + rect.width / 2) insert = index + 1;
    });
    const [lo, hi] = insertBounds(ordered);
    insert = Math.min(Math.max(insert, lo), hi);
    const wrapperLeft = wrapperRef.current?.getBoundingClientRect().left ?? 0;
    const edge = insert < rects.length ? rects[insert]?.left : rects[rects.length - 1]?.right;
    return { insert, indicatorX: (edge ?? 0) - wrapperLeft };
  };

  const startReorder = (
    event: ReactPointerEvent<HTMLButtonElement>,
    column: DataTableColumn<T>,
  ) => {
    if (event.button !== 0 || event.pointerType === 'touch' || !isMovable(column)) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const label = columnLabel(column);
    let phase: 'pending' | 'dragging' | 'cancelled' = 'pending';
    let insert = -1;

    const onMove = (ev: PointerEvent) => {
      if (phase === 'cancelled') return;
      if (
        phase === 'pending' &&
        Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD
      )
        return;
      phase = 'dragging';
      const located = locateInsert(ev.clientX);
      insert = located.insert;
      setDragView({
        id: column.id,
        label,
        x: ev.clientX,
        y: ev.clientY,
        indicatorX: located.indicatorX,
      });
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || phase !== 'dragging') return;
      // 드래그만 취소한다 — 바깥 모달(<dialog> cancel)·onKeyDown 까지 가지 않게 막는다
      ev.preventDefault();
      ev.stopImmediatePropagation();
      phase = 'cancelled';
      setDragView(null);
      setAnnouncement(`${label} 열 이동 취소`);
    };
    const finish = (commit: boolean) => {
      cleanup();
      if (phase === 'pending') return; // 5px 미만 → click 이 정렬한다
      suppressNextClick();
      setDragView(null);
      if (!commit || phase !== 'dragging') return;
      const from = layout.order.indexOf(column.id);
      const to = insert > from ? insert - 1 : insert;
      if (insert >= 0 && to !== from) moveColumn(column, to);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    function cleanup() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      cleanupRef.current = null;
    }
    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, column: DataTableColumn<T>) => {
    // 헤더 버튼의 재배치·정렬로 번지지 않게 항상 막는다 (#32 스펙 §5)
    event.stopPropagation();
    if (event.button !== 0 || event.pointerType === 'touch') return;
    event.preventDefault();
    const base = ensureBaseline();
    const startX = event.clientX;
    const startWidth = layout.widths[column.id] ?? base[column.id] ?? 0;
    let current = startWidth;
    setDraft({ id: column.id, width: startWidth });

    const onMove = (ev: PointerEvent) => {
      current = clampWidth(column, startWidth + ev.clientX - startX);
      setDraft({ id: column.id, width: current });
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish(false);
    };
    const finish = (commit: boolean) => {
      cleanup();
      suppressNextClick();
      setDraft(null);
      if (commit && current !== startWidth) commitWidth(column, current);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    function cleanup() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      cleanupRef.current = null;
    }
    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
  };

  const onHeaderKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    column: DataTableColumn<T>,
  ) => {
    if (!event.altKey || !event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (!isMovable(column)) return;
    const from = ordered.indexOf(column);
    const to = from + (event.key === 'ArrowLeft' ? -1 : 1);
    const [lo, hi] = insertBounds(ordered);
    if (to < lo || to >= hi) return;
    pendingFocusRef.current = column.id;
    moveColumn(column, to);
  };

  const onHandleKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    column: DataTableColumn<T>,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const base = ensureBaseline();
    const current = layout.widths[column.id] ?? base[column.id] ?? 0;
    const delta = event.key === 'ArrowLeft' ? -RESIZE_STEP : RESIZE_STEP;
    const next = clampWidth(column, current + delta);
    if (next !== layout.widths[column.id]) commitWidth(column, next);
  };

  // ── 렌더 ────────────────────────────────────────────────────────────────
  const widths = ordered.map((column) => widthOf(column.id));
  const totalWidth = widths.every((width) => width !== undefined)
    ? widths.reduce<number>((sum, width) => sum + (width ?? 0), 0)
    : undefined;

  return (
    // 표는 밀집 컨테이너(Q-D1 = B) — Table 래퍼와 같이 표 밖에 뜨는 끌기 라벨까지 sm
    <div ref={wrapperRef} {...densityAttrs('sm')} className="relative">
      <Table
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(fixed && totalWidth !== undefined && 'w-auto', className)}
        style={fixed ? { tableLayout: 'fixed', width: totalWidth ?? undefined } : undefined}
      >
        {fixed ? (
          <colgroup>
            {ordered.map((column) => {
              const width = widthOf(column.id);
              return (
                <col
                  key={column.id}
                  data-column-id={column.id}
                  style={width !== undefined ? { width } : undefined}
                />
              );
            })}
          </colgroup>
        ) : null}
        <TableHead className={headClassName}>
          <tr>
            {ordered.map((column) => {
              const sortable = isSortable(column, sortMode);
              const dir = sort?.id === column.id && sortable ? sort.dir : null;
              const labelId = `${domId}-${column.id}`;
              const align = column.align ? ALIGN_CLASSES[column.align] : undefined;
              const width = widthOf(column.id);
              const filtered = filteredColumns.has(column.id);
              return (
                // TableHeaderCell 은 ref 를 받지 않는 서버 호환 프리미티브라 같은 클래스의 <th> 를 직접 쓴다
                <th
                  key={column.id}
                  scope="col"
                  ref={(el) => {
                    if (el) thRefs.current.set(column.id, el);
                    else thRefs.current.delete(column.id);
                  }}
                  data-column-id={column.id}
                  data-filtered={filtered ? 'true' : undefined}
                  // 핸들의 aria-label 이 열 이름에 섞이지 않도록 이름은 라벨 span 으로만 정한다
                  aria-labelledby={labelId}
                  aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'relative px-3 py-2.5 text-left text-[12px] font-semibold whitespace-nowrap text-text-tertiary',
                    align,
                    fixed && 'overflow-hidden text-ellipsis',
                    dragView?.id === column.id && 'opacity-50',
                    column.headerClassName,
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) buttonRefs.current.set(column.id, el);
                        else buttonRefs.current.delete(column.id);
                      }}
                      onPointerDown={(event) => startReorder(event, column)}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        toggleSort(column);
                      }}
                      onKeyDown={(event) => onHeaderKeyDown(event, column)}
                      className={cn(
                        'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent p-0 align-middle text-inherit select-none [font:inherit] hover:text-text-primary',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
                        column.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      <span id={labelId}>{column.header}</span>
                      {filtered ? <FilterDot /> : null}
                      <SortIcon dir={dir} />
                    </button>
                  ) : isMovable(column) ? (
                    // 정렬하지 않는 데이터 열도 키보드로 이동할 수 있게 버튼으로 둔다 (클릭은 아무 일도 하지 않음)
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) buttonRefs.current.set(column.id, el);
                        else buttonRefs.current.delete(column.id);
                      }}
                      onPointerDown={(event) => startReorder(event, column)}
                      onClick={(event) => {
                        event.stopPropagation();
                        suppressClickRef.current = false;
                      }}
                      onKeyDown={(event) => onHeaderKeyDown(event, column)}
                      className={cn(
                        'inline-flex max-w-full cursor-grab items-center gap-1 border-0 bg-transparent p-0 align-middle text-inherit select-none [font:inherit]',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
                      )}
                    >
                      <span id={labelId}>{column.header}</span>
                      {filtered ? <FilterDot /> : null}
                    </button>
                  ) : filtered ? (
                    <span className="inline-flex items-center gap-1 align-middle">
                      <span id={labelId}>{column.header}</span>
                      <FilterDot />
                    </span>
                  ) : (
                    <span id={labelId}>{column.header}</span>
                  )}
                  {column.resizable !== false ? (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`${columnLabel(column)} 열 너비 조절`}
                      aria-valuenow={width ?? renderedWidths[column.id]}
                      aria-valuemin={column.minWidth ?? MIN_COL_WIDTH}
                      aria-valuemax={column.maxWidth ?? MAX_COL_WIDTH}
                      tabIndex={0}
                      onPointerDown={(event) => startResize(event, column)}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        resetWidth(column);
                      }}
                      onKeyDown={(event) => onHandleKeyDown(event, column)}
                      className={cn(
                        'absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none outline-none',
                        'before:absolute before:inset-y-2 before:right-0 before:w-0.5 before:rounded-full before:bg-transparent',
                        'hover:before:bg-border-default focus-visible:before:bg-focus-ring',
                        draft?.id === column.id && 'before:bg-focus-ring',
                      )}
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </TableHead>
        <TableBody
          // 열 리사이즈·재배치 드래그가 본문 위에서 끝난 직후의 click 은 본문(행 클릭·칸 안 버튼)으로 보내지 않는다
          // (price-change-history-modal §2.2-2). 브라우저는 보통 그 click 을 누름·놓음의 공통 조상(<table>)으로 보내지만,
          // 놓은 지점이 본문 칸이어도 행 드로어·칸 버튼(가격 변동 이력 등)이 열리지 않도록 캡처 단계에서 한 번 더 막는다
          onClickCapture={(event) => {
            if (!suppressClickRef.current) return;
            suppressClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {showEmpty ? (
            <TableRow>
              <TableCell colSpan={ordered.length} className="p-0">
                <div
                  data-testid="data-table-empty"
                  className="sticky left-0 px-3 py-3"
                  style={emptyWidth !== null ? { width: emptyWidth } : undefined}
                >
                  {empty}
                </div>
              </TableCell>
            </TableRow>
          ) : (
            viewRows.map((row) => (
              <TableRow
                key={getRowKey(row)}
                className={rowClassName?.(row)}
                // 행 클릭(상세 드로어 등)이 있으면 전역 손가락 커서 대상 (UX PR-U1 §2)
                data-clickable={onRowClick ? '' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {ordered.map((column) => (
                  <TableCell
                    key={column.id}
                    // 비데이터 칸(관리·액션)의 클릭은 행 클릭(상세 드로어 등)으로 번지지 않는다 — 버튼 사이 여백 포함
                    onClick={
                      column.type === 'none' && onRowClick
                        ? (event) => event.stopPropagation()
                        : undefined
                    }
                    className={cn(
                      column.align && ALIGN_CLASSES[column.align],
                      fixed && 'overflow-hidden text-ellipsis',
                      column.cellClassName,
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {dragView ? (
        <>
          <div
            aria-hidden="true"
            data-testid="data-table-drop-indicator"
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-primary-600"
            style={{ left: dragView.indicatorX }}
          />
          <div
            aria-hidden="true"
            data-testid="data-table-drag-ghost"
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface-card px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap text-text-secondary opacity-80 shadow-(--shadow-elevated)"
            style={{ left: dragView.x, top: dragView.y }}
          >
            {dragView.label}
          </div>
        </>
      ) : null}

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
