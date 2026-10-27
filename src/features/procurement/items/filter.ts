// 클라이언트(빠른 필터 바·검색)에서도 파싱하므로 JIT(eval) 탐지를 끈 zod 를 쓴다 (CSP, PR-11a QA L-1)
import { z } from '@/lib/zod-jitless';
import {
  hasControlChar,
  parseFilterParams,
  serializeFilters,
  type ColumnFilterDef,
  type FilterCondition,
  type FilterOption,
} from '@/lib/table/filter';
import { appendSortParams, parseSortParams, type SortState } from '@/lib/table/sort-param';

/**
 * 등록 품목(/procurement/items, 조달이 통합 UI-2) URL 상태 — 순수 모듈(서버 모듈 import 없음). 화면(클라이언트)·RSC·조회 상태 정규화·
 * xlsx 내려받기 Route 가 같은 파서·직렬화를 쓴다. URL 이 상태다:
 *
 * - `q` = 물품식별번호·품목명 검색 (페이지 필터, 바 위)
 * - `f.<id>.<op>` = 열 필터 (표 열 필터 스펙 §2 화이트리스트 — itemFilterDefs). 제품·세부분류·제조사 선택지는 데이터(서버 facets)
 * - `page` (1페이지는 생략), `sort`·`dir` 맨 뒤 (#32 §3)
 *
 * 계약단가(unitPrice)는 **원** 단위로 URL 에 쓴다(표 칸은 백만원 — D-3, 슬라이더 범위는 getProcurementItemPriceRange KRW).
 */
export const PROCUREMENT_ITEMS_PATH = '/procurement/items';

/** xlsx 내려받기 Route (현재 필터·정렬 결과, 페이지 무시) */
export const PROCUREMENT_ITEMS_EXPORT_PATH = '/procurement/items/export';

/** xlsx 응답 헤더 — 상한을 넘어 잘렸으면 '1' (화면은 총 건수로 미리 안내하고, 파일 맨 아래에도 안내 줄이 있다) */
export const EXPORT_TRUNCATED_HEADER = 'x-procurement-export-truncated';

/**
 * 서버 정렬 화이트리스트 — server/procurement/items.ts PROCUREMENT_ITEM_SORT_IDS 와 같은 목록(클라이언트가 서버 모듈을 import 하지 않도록
 * 복제, 단위 테스트가 일치를 고정한다). 표 열 id 와 같다.
 */
export const ITEM_SORT_IDS = [
  'registeredOn',
  'product',
  'detailCategory',
  'manufacturer',
  'itemId',
  'itemName',
  'unitPrice',
] as const;
export type ItemSortId = (typeof ITEM_SORT_IDS)[number];

/**
 * 열 필터 id (키 순서 = 필드·URL·칩 순서 = 표 열 순서). 물품식별번호·품목명 열은 검색 `q` 와 같은 의미라 열 필터가 없다.
 */
export const ITEM_FILTER_IDS = [
  'registeredOn',
  'product',
  'detailCategory',
  'manufacturer',
  'unitPrice',
] as const;
export type ItemFilterId = (typeof ITEM_FILTER_IDS)[number];

/** 빠른 필터 바 고정 필드 (스펙 UI-2: 제품·세부분류·제조사). 나머지(등록일자·계약단가)는 "＋ N개 더" */
export const ITEM_QUICK_FIELDS: readonly ItemFilterId[] = [
  'product',
  'detailCategory',
  'manufacturer',
];

export const ITEM_FILTER_LABELS: Record<ItemFilterId, string> = {
  registeredOn: '등록일자',
  product: '제품',
  detailCategory: '세부분류',
  manufacturer: '제조사',
  unitPrice: '계약단가',
};

/** 열 필터 선택지 (서버 getProcurementItemFacets 의 값 목록 — 등록 품목 전체 기준, 빈 값 제외) */
export type ItemFilterChoices = {
  products: readonly string[];
  detailCategories: readonly string[];
  manufacturers: readonly string[];
};

export const NO_ITEM_CHOICES: ItemFilterChoices = {
  products: [],
  detailCategories: [],
  manufacturers: [],
};

const options = (values: readonly string[]): FilterOption[] =>
  values.map((value) => ({ value, label: value }));

/** 화이트리스트 (키 순서 = 필드 순서). 선택지가 비면 그 enum 조건은 URL 에서 버려진다(validateIn) */
export function itemFilterDefs(choices: ItemFilterChoices): Record<ItemFilterId, ColumnFilterDef> {
  return {
    registeredOn: { kind: 'date' },
    product: { kind: 'enum', options: options(choices.products) },
    detailCategory: { kind: 'enum', options: options(choices.detailCategories) },
    manufacturer: { kind: 'enum', options: options(choices.manufacturers) },
    // 통화가 하나(KRW)뿐이라 통화 열이 없다 — 범위는 항상 활성
    unitPrice: { kind: 'money' },
  };
}

/** URL 에 enum(데이터 선택지) 조건이 있는가 — 없으면 정규화가 DB 를 읽지 않아도 된다 */
export function hasChoiceFilterParams(params: Params): boolean {
  return Object.keys(params).some((key) =>
    /^f\.(product|detailCategory|manufacturer)\.in$/.test(key),
  );
}

export type ItemsView = {
  /** 물품식별번호·품목명 검색 */
  q?: string;
  page: number;
  sort?: SortState<ItemSortId>;
  /** 열 필터 (화이트리스트를 통과한 조건). 없으면 키 생략 */
  filters?: FilterCondition[];
};

type Params = Record<string, string | string[] | undefined>;

/** 검색어 — 제어 문자가 든 값은 형식 오류 → 무시(검색 없음, BL-1), 앞뒤 공백 제거, 100자 */
const searchText = z
  .string()
  .refine((value) => !hasControlChar(value))
  .trim()
  .max(100)
  .transform((value) => (value === '' ? undefined : value))
  .optional()
  .catch(undefined);

const pageNumber = z.coerce.number().int().min(1).max(100_000).catch(1).default(1);

function first(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** URL → 화면 상태. 화이트리스트 밖 키·값은 버린다 */
export function parseItemsView(params: Params, defs: Readonly<Record<string, ColumnFilterDef>>) {
  const q = searchText.parse(first(params, 'q'));
  const page = pageNumber.parse(first(params, 'page'));
  const sort = parseSortParams(params, ITEM_SORT_IDS);
  const filters = parseFilterParams(params, defs);
  const view: ItemsView = { page };
  if (q) view.q = q;
  if (sort) view.sort = sort;
  if (filters.length > 0) view.filters = filters;
  return view;
}

/** 화면 상태 → 쿼리스트링('' 또는 '?…'). 순서: q → f.* → page(>1) → sort·dir */
export function itemsViewToQuery(view: Partial<ItemsView>): string {
  const params = new URLSearchParams();
  if (view.q) params.set('q', view.q);
  for (const [key, value] of serializeFilters(view.filters ?? [])) params.append(key, value);
  if (view.page && view.page > 1) params.set('page', String(view.page));
  const query = params.toString();
  return appendSortParams(query ? `?${query}` : '', view.sort);
}

/** 검색 또는 열 필터가 걸렸는가 (정렬 제외) — 빈 상태 구분·'필터 초기화' 노출 */
export function isItemsFiltered(view: Partial<ItemsView>): boolean {
  return Boolean(view.q || (view.filters && view.filters.length > 0));
}

/** xlsx 내려받기 링크 — 현재 검색·열 필터·정렬(페이지 제외) */
export function itemsExportHref(view: Partial<ItemsView>): string {
  return `${PROCUREMENT_ITEMS_EXPORT_PATH}${itemsViewToQuery({ ...view, page: 1 })}`;
}

/**
 * 조회 계층(server/procurement getProcurementItemRows) 필터 — 구조적으로 같은 모양(ProcurementItemFilter 의 부분집합).
 * 클라이언트가 서버 모듈을 import 하지 않도록 여기서 타입을 따로 둔다.
 */
export type ItemQueryFilter = {
  products?: string[];
  detailCategories?: string[];
  manufacturers?: string[];
  q?: string;
  registeredFrom?: string;
  registeredTo?: string;
  priceMin?: number;
  priceMax?: number;
  sort?: SortState<ItemSortId>;
  page?: number;
};

/** 화면 상태 → 조회 필터. 조건 값은 이미 화이트리스트·형식 검증(parseFilterParams)을 통과했다 */
export function toItemQueryFilter(view: ItemsView): ItemQueryFilter {
  const out: ItemQueryFilter = { page: view.page };
  if (view.q) out.q = view.q;
  if (view.sort) out.sort = view.sort;
  for (const cond of view.filters ?? []) {
    if (cond.op === 'in') {
      if (cond.col === 'product') out.products = cond.values;
      else if (cond.col === 'detailCategory') out.detailCategories = cond.values;
      else if (cond.col === 'manufacturer') out.manufacturers = cond.values;
      continue;
    }
    if (cond.col === 'registeredOn') {
      if (cond.op === 'gte') out.registeredFrom = cond.value;
      else if (cond.op === 'lte') out.registeredTo = cond.value;
    } else if (cond.col === 'unitPrice') {
      if (cond.op === 'gte') out.priceMin = Number(cond.value);
      else if (cond.op === 'lte') out.priceMax = Number(cond.value);
    }
  }
  return out;
}
