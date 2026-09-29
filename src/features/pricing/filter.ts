// 클라이언트(필터 UI)에서도 파싱하므로 JIT(eval) 탐지를 끈 zod 를 쓴다 (CSP, PR-11a QA L-1)
import { z } from '@/lib/zod-jitless';

/**
 * 가격정책 조회 필터 (§4.5.1·§4.5.2) — URL 검색 파라미터가 곧 상태다(공유·뒤로가기·새로고침 유지).
 * 서버(쿼리)와 클라이언트(필터 UI)가 같은 파서를 쓴다.
 */
export const DATE_MODES = ['start', 'period'] as const;
export type DateMode = (typeof DATE_MODES)[number];

/** 드롭다운 첫 항목 `전체` = 필터 없음 */
export const ALL = '전체';

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
};

export type FilterErrors = Partial<Record<'from' | 'to', string>>;

type Params = Record<string, string | string[] | undefined>;

const text = z
  .string()
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
export function parsePriceFilter(params: Params): { filter: PriceFilter; errors: FilterErrors } {
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
  return { filter: { ...parsed, family, from, to, mid, minor }, errors };
}

/** 필터 → 쿼리스트링 (기본값·빈 값·1페이지는 생략) */
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
    ['page', filter.page && filter.page > 1 ? filter.page : undefined],
  ];
  for (const [key, value] of entries)
    if (value !== undefined && value !== '') params.set(key, String(value));
  const query = params.toString();
  return query ? `?${query}` : '';
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
