import type { DataTableFilterField } from '@/components/ui/data-table/filter-fields';
import { STATUS_ORDERS } from '@/lib/table/compare';
import type { ColumnFilterDef, FilterOption } from '@/lib/table/filter';

import type { CostRowView } from './types';

/**
 * 원가 표 열 필터 (표 열 필터 스펙 §2.3·§2.4) — 클라이언트(툴바)·서버(URL 파싱·SQL 화이트리스트) 공용.
 * 이 화면은 cost.read 가 있어야만 열리고(requireCostPageAccess), 쿼리는 assertCostAccess 를 그대로 거친다.
 *
 * 열 필터를 만들지 않는 열:
 * - 원자재 코드·원자재명 = 기존 검색 `q`(원자재명·코드)와 같은 의미
 * - 적용시작일·적용기간 = 기존 기간(dateMode·from·to)과 같은 의미
 * - 관리 = 비데이터 열 (제품군은 탭 — 표 열이 아님)
 *
 * '통화' 는 표에 열이 없는 필터 전용 항목(원가의 currencyCol) — 통화가 하나로 정해졌을 때만 원가 범위가 활성(§2.1-2).
 */
export const COST_FILTER_IDS = ['unit', 'currency', 'cost', 'status'] as const;
export type CostFilterId = (typeof COST_FILTER_IDS)[number];

const options = (values: readonly string[]): FilterOption[] =>
  values.map((value) => ({ value, label: value }));

/** 화이트리스트 (키 순서 = 필드 순서). currencies = 데이터에 있는 통화 코드(서버 listCostCurrencies) */
export function costFilterDefs(
  currencies: readonly string[],
): Record<CostFilterId, ColumnFilterDef> {
  return {
    unit: { kind: 'text' },
    currency: { kind: 'enum', options: options(currencies) },
    cost: { kind: 'money', currencyCol: 'currency' },
    status: { kind: 'enum', options: options(STATUS_ORDERS.pricingState) },
  };
}

const COST_FILTER_LABELS: Record<CostFilterId, string> = {
  unit: '단위',
  currency: '통화',
  cost: '원가',
  status: '상태',
};

/** 클라이언트 값 접근자 — 표 칸과 같은 값 (서버·클라이언트 일치 테스트의 기준) */
const COST_FILTER_VALUES: Record<CostFilterId, DataTableFilterField<CostRowView>['value']> = {
  unit: (row) => row.unit,
  currency: (row) => row.currency,
  cost: (row) => ({ amount: Number(row.unitCost), currency: row.currency }),
  status: (row) => row.operationStatus,
};

export function costFilterFields(
  currencies: readonly string[],
): DataTableFilterField<CostRowView>[] {
  const defs = costFilterDefs(currencies);
  return COST_FILTER_IDS.map((id) => ({
    id,
    label: COST_FILTER_LABELS[id],
    filter: defs[id],
    value: COST_FILTER_VALUES[id],
  }));
}
