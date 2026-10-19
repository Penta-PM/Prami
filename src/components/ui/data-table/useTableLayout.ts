'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  clearLayout,
  defaultLayout,
  isDefaultLayout,
  layoutStorageKey,
  parseLayout,
  readLayoutRaw,
  subscribeLayout,
  writeLayout,
  type LayoutColumn,
  type TableLayout,
} from '@/lib/table/layout-storage';

/** '열 초기화' 알림 — 같은 키의 DataTable 이 받아 첫 헤더로 포커스를 옮기고 라이브 영역에 알린다 (#32 스펙 §9 Q4) */
export const TABLE_RESET_EVENT = 'prami:table-reset';
export type TableResetDetail = { key: string };

export type TableLayoutState = {
  layout: TableLayout;
  isDefault: boolean;
  save: (next: TableLayout) => void;
  reset: () => void;
  /** 저장 키 (layoutStorageKey) */
  key: string;
};

/**
 * 열 순서·너비 저장소 구독 (#32 스펙 §5).
 * 스냅샷은 localStorage 원문 문자열(원시값이라 매 렌더 같은 값 → 무한 루프 없음)이고, 서버 스냅샷은 null 이다.
 * 그래서 첫 렌더(SSR·하이드레이션)는 항상 기본 레이아웃이고 저장값은 그 뒤에 적용된다 — 하이드레이션 불일치 0.
 * 같은 키를 구독하는 표와 '열 초기화' 버튼은 writeLayout/clearLayout 알림으로 함께 갱신된다.
 */
export function useTableLayout(
  tableId: string,
  userId: string,
  columns: readonly LayoutColumn[],
): TableLayoutState {
  const key = layoutStorageKey(tableId, userId);
  const subscribe = useCallback((onChange: () => void) => subscribeLayout(key, onChange), [key]);
  const raw = useSyncExternalStore(
    subscribe,
    () => readLayoutRaw(key),
    () => null,
  );
  const layout = useMemo(() => parseLayout(raw, columns) ?? defaultLayout(columns), [raw, columns]);
  const isDefault = useMemo(() => isDefaultLayout(layout, columns), [layout, columns]);
  const save = useCallback((next: TableLayout) => writeLayout(key, next, columns), [key, columns]);
  const reset = useCallback(() => {
    clearLayout(key);
    window.dispatchEvent(new CustomEvent<TableResetDetail>(TABLE_RESET_EVENT, { detail: { key } }));
  }, [key]);
  return { layout, isDefault, save, reset, key };
}
