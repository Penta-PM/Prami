// 클라이언트(필터 UI)에서도 파싱하므로 JIT(eval) 탐지를 끈 zod 를 쓴다 (CSP, PR-11a QA L-1)
import { z } from '@/lib/zod-jitless';
import {
  hasControlChar,
  parseFilterParams,
  serializeFilters,
  type ColumnFilterDef,
  type FilterCondition,
} from '@/lib/table/filter';
import { appendSortParams, parseSortParams, type SortState } from '@/lib/table/sort-param';

/**
 * 가격정책 조회 필터 (§4.5.1·§4.5.2) — URL 검색 파라미터가 곧 상태다(공유·뒤로가기·새로고침 유지).
 * 서버(쿼리)와 클라이언트(필터 UI)가 같은 파서를 쓴다.
 */
export const DATE_MODES = ['start', 'period'] as const;
export type DateMode = (typeof DATE_MODES)[number];

/** 드롭다운 첫 항목 `전체` = 필터 없음 */
export const ALL = '전체';

/** 서버 정렬 화이트리스트 (#32 스펙 §3) — 표 열 id 와 같다. 관리(actions) 열은 정렬하지 않는다 */
export const PRICE_SORT_IDS = [
  'priceType',
  'major',
  'mid',
  'minor',
  'itemName',
  'price',
  'effectiveFrom',
  'period',
  'operationYears',
  'itemStatus',
  'status',
  'remark',
  'priceChange',
] as const;
export type PriceSortId = (typeof PRICE_SORT_IDS)[number];

/**
 * 조회 화면(/pricing)·가격 변동 권한 없음의 정렬 화이트리스트 (pricing-view-hide-price-change §2) — 가격 변동 제외.
 * `sort=priceChange` 는 파싱에서 버려져 기본 정렬이 된다(오류 없음)
 */
export const PRICE_VIEW_SORT_IDS: readonly PriceSortId[] = PRICE_SORT_IDS.filter(
  (id) => id !== 'priceChange',
);

/** 가격 변동 노출(관리 화면 + pricing.write, 서버 판정)에 맞는 정렬 화이트리스트 */
export function priceSortIds(withPriceChange: boolean): readonly PriceSortId[] {
  return withPriceChange ? PRICE_SORT_IDS : PRICE_VIEW_SORT_IDS;
}

export type PriceFilter = {
  major?: string;
  /** 홈 카드 묶음(product-cards id, 예: isign = iSIGN + iSIGN PKI). major 와 함께 오면 major 가 우선 */
  family?: string;
  mid?: string;
  minor?: string;
  dateMode: DateMode;
  from?: string;
  to?: string;
  q?: string;
  page: number;
  /** 단일 열 정렬. 없으면 기본 정렬(effective_from DESC, item_name, id) */
  sort?: SortState<PriceSortId>;
  /** 열 필터 `f.<col>.<op>` (표 열 필터 스펙 §2) — 화이트리스트(priceFilterDefs)로 파싱한 결과. 없으면 키 생략 */
  filters?: FilterCondition[];
};

export type FilterErrors = Partial<Record<'from' | 'to', string>>;

type Params = Record<string, string | string[] | undefined>;

/** 문자열 파라미터(분류·검색어 q 등). 제어 문자가 든 값은 형식 오류 → 그 파라미터만 무시(검색 없음과 같음, BL-1) */
const text = z
  .string()
  .refine((value) => !hasControlChar(value))
  .trim()
  .max(100)
  .transform((value) => (value === '' || value === ALL ? undefined : value))
  .optional()
  .catch(undefined);

const isoDate = z.iso.date().optional().catch(undefined);

const schema = z.object({
  major: text,
  family: text,
  mid: text,
  minor: text,
  dateMode: z.enum(DATE_MODES).catch('start').default('start'),
  from: isoDate,
  to: isoDate,
  q: text,
  page: z.coerce.number().int().min(1).max(100_000).catch(1).default(1),
});

function first(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * URL → 필터. 잘못된 날짜는 버리고, `from > to` 이면 폼 오류로 알리고 날짜 조건을 적용하지 않는다(§4.5.2).
 * 상위 분류가 없으면 하위 분류도 무시한다(상위 변경 시 하위 초기화 규칙).
 */
export function parsePriceFilter(
  params: Params,
  /** 열 필터 화이트리스트(priceFilterDefs). 생략하면 열 필터를 읽지 않는다 */
  filterDefs: Readonly<Record<string, ColumnFilterDef>> = {},
  /** 정렬 화이트리스트 — 기본 = PRICE_VIEW_SORT_IDS(가격 변동 제외). 관리 화면 + pricing.write 만 PRICE_SORT_IDS */
  sortIds: readonly PriceSortId[] = PRICE_VIEW_SORT_IDS,
): { filter: PriceFilter; errors: FilterErrors } {
  const raw = Object.fromEntries(
    ['major', 'family', 'mid', 'minor', 'dateMode', 'from', 'to', 'q', 'page'].map((key) => [
      key,
      first(params, key),
    ]),
  );
  const parsed = schema.parse(raw);
  const errors: FilterErrors = {};
  if (raw.from && !parsed.from) errors.from = '날짜 형식(YYYY-MM-DD)이 아닙니다';
  if (raw.to && !parsed.to) errors.to = '날짜 형식(YYYY-MM-DD)이 아닙니다';
  let { from, to } = parsed;
  if (from && to && from > to) {
    errors.to = '종료일은 시작일 이후여야 합니다';
    from = undefined;
    to = undefined;
  }
  const mid = parsed.major ? parsed.mid : undefined;
  const minor = mid ? parsed.minor : undefined;
  const family = parsed.major ? undefined : parsed.family;
  const sort = parseSortParams(params, sortIds);
  const filters = parseFilterParams(params, filterDefs);
  return {
    filter: {
      ...parsed,
      family,
      from,
      to,
      mid,
      minor,
      ...(filters.length > 0 ? { filters } : {}),
      ...(sort ? { sort } : {}),
    },
    errors,
  };
}

/**
 * 기존 필터(분류 연쇄·적용기간 기준·검색) 또는 열 필터가 걸렸는가 — 정렬은 제외.
 * 결과 0건일 때 빈 상태 2종(데이터 없음 / 필터 결과 없음) 구분과 '필터 초기화' 노출(정렬과 함께, Plan Q1 B)에 쓴다.
 */
export function isPriceFiltered(filter: Partial<PriceFilter>): boolean {
  return Boolean(
    filter.major ||
    filter.family ||
    filter.mid ||
    filter.minor ||
    filter.dateMode === 'period' ||
    filter.from ||
    filter.to ||
    filter.q ||
    (filter.filters && filter.filters.length > 0),
  );
}

/**
 * 필터 → 쿼리스트링 (기본값·빈 값·1페이지는 생략). 열 필터 `f.*` 는 기존 필터 뒤·page 앞,
 * sort·dir 는 항상 맨 뒤 (#32 §3, E2E URL 정규식 보호)
 */
export function filterToQuery(filter: Partial<PriceFilter>): string {
  const params = new URLSearchParams();
  const entries: [string, string | number | undefined][] = [
    ['major', filter.major],
    ['family', filter.major ? undefined : filter.family],
    ['mid', filter.mid],
    ['minor', filter.minor],
    ['dateMode', filter.dateMode === 'period' ? 'period' : undefined],
    ['from', filter.from],
    ['to', filter.to],
    ['q', filter.q],
  ];
  for (const [key, value] of entries)
    if (value !== undefined && value !== '') params.set(key, String(value));
  for (const [key, value] of serializeFilters(filter.filters ?? [])) params.append(key, value);
  if (filter.page && filter.page > 1) params.set('page', String(filter.page));
  const query = params.toString();
  return appendSortParams(query ? `?${query}` : '', filter.sort);
}

/** 연도 퀵칩 = from=YYYY-01-01&to=YYYY-12-31 (R-B) */
export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** 현재 필터가 특정 연도 칩과 같은지 */
export function activeYear(filter: Pick<PriceFilter, 'from' | 'to'>): number | null {
  if (!filter.from || !filter.to) return null;
  const year = Number(filter.from.slice(0, 4));
  const range = yearRange(year);
  return range.from === filter.from && range.to === filter.to ? year : null;
}
