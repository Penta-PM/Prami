import type { DataTableFilterField } from '@/components/ui/data-table/filter-fields';
import { isEmptySortValue, STATUS_ORDERS } from '@/lib/table/compare';
import { FILTER_LIMITS, type ColumnFilterDef, type FilterOption } from '@/lib/table/filter';

import { PRICE_TABLE_COLUMNS, type PriceColumnKey } from './columns';
import type { PriceRowView } from './types';

/**
 * 가격 조회·관리 표 열 필터 (표 열 필터 스펙 §2.3·§2.4) — 클라이언트(툴바)·서버(URL 파싱·SQL 화이트리스트) 공용.
 *
 * 열 필터를 만들지 않는 열:
 * - 대·중·소분류, 품목명 = 기존 분류 연쇄·검색 `q` 와 같은 의미 (§2.4)
 * - 적용시작일·적용기간·운영 연도 = 기존 적용기간 기준(dateMode·from·to)과 같은 의미 (운영 연도는 적용기간의 연도 표시)
 * - 원가 비중 = 필터 불가 (§2.3-4, 비범위)
 * - 관리 = 비데이터 열
 *
 * '통화' 는 표에 열이 없는 필터 전용 항목(판매가의 currencyCol) — 통화가 하나로 정해졌을 때만 판매가 범위가 활성(§2.1-2).
 * 단가 유형은 데이터의 distinct 값으로 만든 다중 선택(enum `in`, Plan §7 Q3 B) — 목록에 없는 URL 값은 버린다.
 *   비어 있는 단가 유형(NULL·''·공백만·'—', 표 칸은 priceTypeLabel 로 '—')은 선택지 하나 `PRICE_TYPE_NONE` 로 묶는다
 *   (서버: 빈 값 판정 isEmptyText, 클라이언트: 접근자가 빈 값을 같은 값으로 바꾼다).
 * 순서 = URL·칩 순서 (열 순서, 통화는 판매가 바로 앞).
 */
export const PRICE_FILTER_IDS = [
  'priceType',
  'currency',
  'price',
  'priceChange',
  'itemStatus',
  'status',
  'remark',
] as const;
export type PriceFilterId = (typeof PRICE_FILTER_IDS)[number];

const options = (values: readonly string[]): FilterOption[] =>
  values.map((value) => ({ value, label: value }));

/** 비어 있는 단가 유형의 선택지 값 (URL `f.priceType.in=__none__`) — 실제 값과 겹치지 않게 고정 표식 */
export const PRICE_TYPE_NONE = '__none__';
const PRICE_TYPE_NONE_LABEL = '— (없음)';

/**
 * 단가 유형 선택지: 서버 listPriceTypes 결과(빈 값은 PRICE_TYPE_NONE 하나로) → 옵션.
 * 쉼표가 든 값("Standby,DR" 등)도 고를 수 있다 — `in` URL 코덱이 백슬래시로 이스케이프한다(Plan §7, §2.2 개정).
 * 100자를 넘는 값만 한도(§2.1-4) 때문에 고를 수 없다(실데이터에는 없음).
 */
export function priceTypeOptions(priceTypes: readonly string[]): FilterOption[] {
  return priceTypes
    .filter((value) => value === PRICE_TYPE_NONE || value.length <= FILTER_LIMITS.valueMax)
    .map((value) => ({
      value,
      label: value === PRICE_TYPE_NONE ? PRICE_TYPE_NONE_LABEL : value,
    }));
}

const label = (key: PriceColumnKey): string =>
  PRICE_TABLE_COLUMNS.find((column) => column.key === key)?.label ?? key;

/**
 * 화이트리스트 (키 순서 = 필드 순서). currencies = 데이터에 있는 통화 코드(서버 listPriceCurrencies),
 * priceTypes = 데이터에 있는 단가 유형(서버 listPriceTypes — 빈 값은 PRICE_TYPE_NONE)
 */
export function priceFilterDefs(
  currencies: readonly string[],
  priceTypes: readonly string[] = [],
): Record<PriceFilterId, ColumnFilterDef> {
  return {
    priceType: { kind: 'enum', options: priceTypeOptions(priceTypes) },
    currency: { kind: 'enum', options: options(currencies) },
    price: { kind: 'money', currencyCol: 'currency' },
    priceChange: { kind: 'number' },
    itemStatus: { kind: 'enum', options: options(STATUS_ORDERS.partMapping) },
    status: { kind: 'enum', options: options(STATUS_ORDERS.pricingState) },
    remark: { kind: 'text' },
  };
}

/** 클라이언트 값 접근자 — 표 칸과 같은 값 (서버·클라이언트 일치 테스트의 기준) */
const PRICE_FILTER_VALUES: Record<PriceFilterId, DataTableFilterField<PriceRowView>['value']> = {
  priceType: (row) => (isEmptySortValue(row.priceType) ? PRICE_TYPE_NONE : row.priceType),
  currency: (row) => row.currency,
  price: (row) => ({ amount: Number(row.unitPrice), currency: row.currency }),
  priceChange: (row) => row.priceChangeRate,
  itemStatus: (row) => row.itemStatus,
  status: (row) => row.operationStatus,
  remark: (row) => row.remark,
};

const PRICE_FILTER_LABELS: Record<PriceFilterId, string> = {
  priceType: label('priceType'),
  currency: '통화',
  price: label('price'),
  priceChange: label('priceChange'),
  itemStatus: label('itemStatus'),
  status: label('status'),
  remark: label('remark'),
};

/** 툴바 필드 (서버 표 — value 는 일치 테스트에서만 쓴다) */
export function priceFilterFields(
  currencies: readonly string[],
  priceTypes: readonly string[] = [],
): DataTableFilterField<PriceRowView>[] {
  const defs = priceFilterDefs(currencies, priceTypes);
  return PRICE_FILTER_IDS.map((id) => ({
    id,
    label: PRICE_FILTER_LABELS[id],
    filter: defs[id],
    value: PRICE_FILTER_VALUES[id],
  }));
}
