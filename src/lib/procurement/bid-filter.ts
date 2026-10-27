import { PROCUREMENT_PRODUCTS, type ProcurementProduct } from './constants';

/**
 * 입찰 공고(`/procurement/bids`) 조회 조건 ↔ URL (조달이 통합 UI-3). 순수 모듈 — 화면(서버 page·클라이언트 필터 바)과
 * 조회 상태 정규화(page_key `procurement-bids`)가 **같은** 파서·직렬화를 쓴다. URL 이 상태다.
 *
 * - `product` = WAPPLES | D.AMO | iSIGN (없음 = 전체)
 * - `closed=1` = 마감 포함 (없음 = 진행 중만)
 * - `top=1` = 적합도 '상'만
 * - `sort=posted` = 게시순 (없음 = 적합도순)
 * - `page` = 2 이상일 때만
 * 기본값·모르는 값은 생략한다(URL 을 짧게, 저장 상태도 같은 모양).
 */

export const BID_SORT_OPTIONS = [
  { value: 'fit', label: '적합도순' },
  { value: 'posted', label: '게시순' },
] as const;
export type BidSortValue = (typeof BID_SORT_OPTIONS)[number]['value'];

export const BID_STATUS_OPTIONS = [
  { value: 'open', label: '진행 중' },
  { value: 'all', label: '마감 포함' },
] as const;
export type BidStatusValue = (typeof BID_STATUS_OPTIONS)[number]['value'];

export type BidFilter = {
  product: ProcurementProduct | null;
  includeClosed: boolean;
  topGradeOnly: boolean;
  sort: BidSortValue;
  page: number;
};

export const DEFAULT_BID_FILTER: BidFilter = {
  product: null,
  includeClosed: false,
  topGradeOnly: false,
  sort: 'fit',
  page: 1,
};

/** 페이지 번호 상한 (조작된 URL 방어 — 감사 로그와 같은 값) */
const MAX_PAGE = 10_000;

type Params = Record<string, string | string[] | undefined>;

function first(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function isProcurementProduct(value: unknown): value is ProcurementProduct {
  return typeof value === 'string' && (PROCUREMENT_PRODUCTS as readonly string[]).includes(value);
}

/** URL 파라미터 → 조회 조건 (모르는 값은 기본값) */
export function parseBidFilter(params: Params): BidFilter {
  const product = first(params, 'product');
  const page = Number(first(params, 'page'));
  return {
    product: isProcurementProduct(product) ? product : null,
    includeClosed: first(params, 'closed') === '1',
    topGradeOnly: first(params, 'top') === '1',
    sort: first(params, 'sort') === 'posted' ? 'posted' : 'fit',
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  };
}

/** 조회 조건 → 쿼리스트링 (`?…`, 기본 상태면 '') — 키 순서 고정(product·closed·top·sort·page) */
export function bidFilterToQuery(filter: Partial<BidFilter>): string {
  const params = new URLSearchParams();
  if (filter.product && isProcurementProduct(filter.product)) params.set('product', filter.product);
  if (filter.includeClosed) params.set('closed', '1');
  if (filter.topGradeOnly) params.set('top', '1');
  if (filter.sort === 'posted') params.set('sort', 'posted');
  if (filter.page && Number.isInteger(filter.page) && filter.page > 1 && filter.page <= MAX_PAGE)
    params.set('page', String(filter.page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const BIDS_PATH = '/procurement/bids';

export function bidsHref(filter: Partial<BidFilter>): string {
  return `${BIDS_PATH}${bidFilterToQuery(filter)}`;
}
