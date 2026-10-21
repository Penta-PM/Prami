import { z } from 'zod';

import { costFilterToQuery as clientCostFilterToQuery } from '@/features/costs/query';
import { COST_SORT_IDS, type CostSortId } from '@/features/costs/sort';
import { DATE_MODES, type DateMode } from '@/features/pricing/filter';
import {
  hasControlChar,
  parseFilterParams,
  type ColumnFilterDef,
  type FilterCondition,
} from '@/lib/table/filter';
import { parseSortParams, type SortState } from '@/lib/table/sort-param';

/** 원가 관리 필터 (§4.5.5): 제품군 탭 + 날짜 두 모드(§4.5.2 공용) + 검색 + 페이지 — URL 상태 */
export type CostFilter = {
  family?: string;
  dateMode: DateMode;
  from?: string;
  to?: string;
  q?: string;
  page: number;
  /** 단일 열 정렬 (#32). 없으면 기본 정렬(effective_from DESC, material_name, id) */
  sort?: SortState<CostSortId>;
  /** 열 필터 `f.<col>.<op>` (표 열 필터 스펙 §2) — 화이트리스트(costFilterDefs)로 파싱한 결과. 없으면 키 생략 */
  filters?: FilterCondition[];
};

export type CostFilterErrors = Partial<Record<'from' | 'to', string>>;

/** 문자열 파라미터(분류·검색어 q 등). 제어 문자가 든 값은 형식 오류 → 그 파라미터만 무시(검색 없음과 같음, BL-1) */
const text = z
  .string()
  .refine((value) => !hasControlChar(value))
  .trim()
  .max(100)
  .transform((value) => (value === '' || value === '전체' ? undefined : value))
  .optional()
  .catch(undefined);

const schema = z.object({
  family: text,
  dateMode: z.enum(DATE_MODES).catch('start').default('start'),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  q: text,
  page: z.coerce.number().int().min(1).max(100_000).catch(1).default(1),
});

type Params = Record<string, string | string[] | undefined>;

export function parseCostFilter(
  params: Params,
  /** 열 필터 화이트리스트(costFilterDefs). 생략하면 열 필터를 읽지 않는다 */
  filterDefs: Readonly<Record<string, ColumnFilterDef>> = {},
): { filter: CostFilter; errors: CostFilterErrors } {
  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const raw = Object.fromEntries(
    ['family', 'dateMode', 'from', 'to', 'q', 'page'].map((k) => [k, pick(k)]),
  );
  const parsed = schema.parse(raw);
  const errors: CostFilterErrors = {};
  if (raw.from && !parsed.from) errors.from = '날짜 형식(YYYY-MM-DD)이 아닙니다';
  if (raw.to && !parsed.to) errors.to = '날짜 형식(YYYY-MM-DD)이 아닙니다';
  let { from, to } = parsed;
  if (from && to && from > to) {
    errors.to = '종료일은 시작일 이후여야 합니다';
    from = undefined;
    to = undefined;
  }
  const sort = parseSortParams(params, COST_SORT_IDS);
  const filters = parseFilterParams(params, filterDefs);
  return {
    filter: {
      ...parsed,
      from,
      to,
      ...(filters.length > 0 ? { filters } : {}),
      ...(sort ? { sort } : {}),
    },
    errors,
  };
}

/** 필터 → 쿼리스트링 — 클라이언트 직렬화(features/costs/query)와 같은 함수. 열 필터는 page 앞, sort·dir 는 맨 뒤 (#32 §3) */
export function costFilterToQuery(filter: Partial<CostFilter>): string {
  return clientCostFilterToQuery(filter);
}
