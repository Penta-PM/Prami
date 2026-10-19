import {
  filterRows,
  type ColumnFilterDef,
  type FilterAccessors,
  type FilterAccessorValue,
  type FilterCondition,
} from '@/lib/table/filter';

import type { DataTableColumn } from './types';

/**
 * 필터할 수 있는 필드 하나 (표 열 필터 스펙 §2.1). 대부분은 `filter` 가 있는 열에서 만들고(`filterFieldsOf`),
 * 표에 열이 없는 조건(예: 내 견적 목록의 '통화' — 금액 열의 currencyCol)은 extra 로 덧붙인다.
 * 서버 표(A-2)는 value 를 쓰지 않는다(행은 이미 서버가 거른 결과).
 */
export type DataTableFilterField<T> = {
  id: string;
  label: string;
  filter: ColumnFilterDef;
  value: (row: T) => FilterAccessorValue;
};

/** 라이브 영역·칩에 쓰는 열 이름 — DataTable 의 columnLabel 과 같은 규칙 */
export function columnLabelOf<T>(column: DataTableColumn<T>): string {
  return column.label ?? (typeof column.header === 'string' ? column.header : column.id);
}

const EMPTY: () => FilterAccessorValue = () => null;

/** `filter` 가 있는 열(열 정의 순서) + extra. 값 접근자는 filterValue → sortValue 순 */
export function filterFieldsOf<T>(
  columns: readonly DataTableColumn<T>[],
  extra: readonly DataTableFilterField<T>[] = [],
): DataTableFilterField<T>[] {
  const fields: DataTableFilterField<T>[] = [];
  for (const column of columns) {
    if (!column.filter) continue;
    fields.push({
      id: column.id,
      label: columnLabelOf(column),
      filter: column.filter,
      value: column.filterValue ?? column.sortValue ?? EMPTY,
    });
  }
  return [...fields, ...extra];
}

/** parseFilterParams·validateCondition 에 넘길 화이트리스트 (키 순서 = 필드 순서 = URL·칩 순서) */
export function filterDefsOf<T>(
  fields: readonly DataTableFilterField<T>[],
): Record<string, ColumnFilterDef> {
  return Object.fromEntries(fields.map((field) => [field.id, field.filter]));
}

export function filterAccessorsOf<T>(
  fields: readonly DataTableFilterField<T>[],
): FilterAccessors<T> {
  return Object.fromEntries(fields.map((field) => [field.id, field.value]));
}

/** 클라이언트 표의 필터 결과(원래 순서 유지). DataTable 과 툴바 건수가 같은 함수를 쓴다 */
export function applyFilterFields<T>(
  rows: readonly T[],
  filters: readonly FilterCondition[],
  fields: readonly DataTableFilterField<T>[],
): readonly T[] {
  if (filters.length === 0) return rows;
  return filterRows(rows, filters, filterAccessorsOf(fields), filterDefsOf(fields));
}
