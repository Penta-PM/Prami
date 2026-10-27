import type { SortDir } from '@/lib/table/compare';
import { appendSortParams, parseSortParams, type SortState } from '@/lib/table/sort-param';

import { PROCUREMENT_ITEM_PRODUCTS } from './constants';

/**
 * 조달 관리 › 품목 관리(`/admin/procurement?tab=items`) 조회 조건 ↔ URL (조달이 통합 UI-7). 순수 모듈 — 서버 섹션(RSC)·클라이언트 조작·
 * 조회 상태 정규화(page_key `admin-procurement` 의 items 탭)가 **같은** 파서·직렬화를 쓴다. URL 이 상태다.
 *
 * `?tab=items&q=…&product=…&page=…&trashPage=…&sort=…&dir=…` — 키 순서 고정, 기본값·모르는 값은 생략(tab=items 는 항상).
 * - `q` = 물품식별번호·품목·제조사 검색 (앞뒤 공백 제거, 100자까지)
 * - `product` = WAPPLES | D.AMO | iSIGN | 기타 (없음 = 전체)
 * - `page` · `trashPage` = 등록 품목·휴지통 페이지 (2 이상일 때만)
 * - `sort` + `dir` = 등록 품목 정렬 (없음 = 등록일자 최신순), 서버 표 공통 규칙(#32 — 맨 뒤)
 */

export const ADMIN_ITEM_SORT_IDS = [
  'registeredOn',
  'product',
  'detailCategory',
  'manufacturer',
  'itemId',
  'itemName',
] as const;
export type AdminItemSortId = (typeof ADMIN_ITEM_SORT_IDS)[number];

export type AdminItemsFilter = {
  q: string;
  product: string | null;
  page: number;
  trashPage: number;
  sort: SortState<AdminItemSortId> | null;
};

export const DEFAULT_ADMIN_ITEMS_FILTER: AdminItemsFilter = {
  q: '',
  product: null,
  page: 1,
  trashPage: 1,
  sort: null,
};

export const ADMIN_PROCUREMENT_PATH = '/admin/procurement';

/** 페이지 번호 상한 (조작된 URL 방어 — 입찰 공고와 같은 값) */
const MAX_PAGE = 10_000;
const MAX_QUERY = 100;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function first(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function pageOf(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}

export function isItemProduct(value: unknown): value is string {
  return (
    typeof value === 'string' && (PROCUREMENT_ITEM_PRODUCTS as readonly string[]).includes(value)
  );
}

/** URL 파라미터 → 조회 조건 (모르는 값은 기본값) */
export function parseAdminItemsFilter(params: Params): AdminItemsFilter {
  const product = first(params, 'product');
  return {
    q: (first(params, 'q') ?? '').trim().slice(0, MAX_QUERY),
    product: isItemProduct(product) ? product : null,
    page: pageOf(first(params, 'page')),
    trashPage: pageOf(first(params, 'trashPage')),
    sort: parseSortParams(params, ADMIN_ITEM_SORT_IDS) ?? null,
  };
}

/** 조회 조건 → 쿼리스트링 (`?tab=items…`) */
export function adminItemsFilterToQuery(filter: Partial<AdminItemsFilter>): string {
  const params = new URLSearchParams({ tab: 'items' });
  const q = filter.q?.trim().slice(0, MAX_QUERY);
  if (q) params.set('q', q);
  if (isItemProduct(filter.product)) params.set('product', filter.product);
  for (const key of ['page', 'trashPage'] as const) {
    const value = filter[key];
    if (value && Number.isInteger(value) && value > 1 && value <= MAX_PAGE)
      params.set(key, String(value));
  }
  const sort =
    filter.sort && (ADMIN_ITEM_SORT_IDS as readonly string[]).includes(filter.sort.id)
      ? filter.sort
      : undefined;
  return appendSortParams(`?${params.toString()}`, sort);
}

export function adminItemsHref(filter: Partial<AdminItemsFilter>): string {
  return `${ADMIN_PROCUREMENT_PATH}${adminItemsFilterToQuery(filter)}`;
}

/** 조회 상태 정규화 (page_key admin-procurement, items 탭) — '?' 없는 쿼리, 항상 `tab=items` 로 시작 */
export function normalizeAdminItemsQuery(params: Params): string {
  return adminItemsFilterToQuery(parseAdminItemsFilter(params)).slice(1);
}

/** 머리글 클릭 — 같은 열이면 오름↔내림, 다른 열이면 오름차순부터 */
export function nextAdminItemSort(
  current: SortState<AdminItemSortId> | null,
  id: AdminItemSortId,
): SortState<AdminItemSortId> {
  const dir: SortDir = current?.id === id && current.dir === 'asc' ? 'desc' : 'asc';
  return { id, dir };
}
