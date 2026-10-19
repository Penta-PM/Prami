import type { DataTableFilterField } from '@/components/ui/data-table/filter-fields';
import { AUDIT_RESULT_LABELS, formatAuditTarget, type AuditDisplayRow } from '@/lib/audit-format';
import {
  FILTER_LIMITS,
  parseFilterParams,
  serializeFilters,
  validateCondition,
  type ColumnFilterDef,
  type FilterCondition,
} from '@/lib/table/filter';
import { appendSortParams, parseSortParams, type SortState } from '@/lib/table/sort-param';

import { AUDIT_SORT_IDS, type AuditSortId } from './sort';

/**
 * 감사 로그 열 필터 (표 열 필터 스펙 §2.4) — 기존 GET 폼(시작·종료일·행위·사용자)을 열 필터로 흡수했다.
 * 클라이언트(툴바·URL)·서버(파싱·SQL) 공용 순수 모듈.
 *
 * 별칭 — 기존 URL 파라미터를 그대로 읽고 쓴다(옛 링크·북마크·E2E 의 `?action=X` 호환):
 * | 열 | 조건 | URL |
 * |---|---|---|
 * | 일시 createdAt | date gte / lte (KST 날짜) | `from` / `to` |
 * | 행위 action | enum in (다중) | `action` (쉼표 구분 — 단일 값은 옛 형식 그대로) |
 * | 사용자 actor | text has | `actor` |
 * | 사용자 actor | text eq | `f.actor.eq` (옛 폼에 없던 연산자) |
 * | 대상 target · IP ip | text has / eq | `f.target.*` · `f.ip.*` |
 * | 결과 result | enum in | `f.result.in` |
 * 변경 전/후(JSON)는 필터 없음. 별칭 열의 `f.createdAt.*`·`f.action.in`·`f.actor.has` 는 받지 않는다(같은 조건의 키가 하나뿐이도록).
 */
export const AUDIT_FILTER_IDS = ['createdAt', 'actor', 'action', 'target', 'ip', 'result'] as const;
export type AuditFilterId = (typeof AUDIT_FILTER_IDS)[number];

/** 화면·CSV 공용 필터 (URL 상태) */
export type AuditFilter = {
  /** 일시 ≥ (KST 날짜) */
  from?: string;
  /** 일시 ≤ (KST 날짜, 그날 끝까지) */
  to?: string;
  /** 행위 (다중, 쉼표 구분 URL) */
  action?: string[];
  /** 사용자 포함 */
  actor?: string;
  /** 별칭이 없는 열 필터 (`f.actor.eq`·`f.target.*`·`f.ip.*`·`f.result.in`). 없으면 키 생략 */
  filters?: FilterCondition[];
  page: number;
  /** 단일 열 정렬 (#32). 없으면 기본 정렬(created_at DESC, id DESC). 화면·CSV 공용 */
  sort?: SortState<AuditSortId>;
};

const RESULT_OPTIONS = (Object.keys(AUDIT_RESULT_LABELS) as AuditDisplayRow['result'][]).map(
  (value) => ({ value, label: AUDIT_RESULT_LABELS[value] }),
);

/** 화이트리스트 (키 순서 = 열 순서 = 칩 순서). actions = 행위 선택지(데이터, listAuditActions) */
export function auditFilterDefs(
  actions: readonly string[],
): Record<AuditFilterId, ColumnFilterDef> {
  return {
    createdAt: { kind: 'date' },
    actor: { kind: 'text' },
    action: { kind: 'enum', options: actions.map((value) => ({ value, label: value })) },
    target: { kind: 'text' },
    ip: { kind: 'text' },
    result: { kind: 'enum', options: RESULT_OPTIONS },
  };
}

const AUDIT_FILTER_LABELS: Record<AuditFilterId, string> = {
  createdAt: '일시',
  actor: '사용자',
  action: '행위',
  target: '대상',
  ip: 'IP',
  result: '결과',
};

/** 클라이언트 값 접근자 — 표 칸과 같은 값 (서버·클라이언트 일치 테스트의 기준) */
const AUDIT_FILTER_VALUES: Record<AuditFilterId, DataTableFilterField<AuditDisplayRow>['value']> = {
  createdAt: (row) => row.createdAt,
  actor: (row) => row.actorLabel,
  action: (row) => row.action,
  target: (row) => formatAuditTarget(row),
  ip: (row) => row.ip,
  result: (row) => row.result,
};

export function auditFilterFields(
  actions: readonly string[],
): DataTableFilterField<AuditDisplayRow>[] {
  const defs = auditFilterDefs(actions);
  return AUDIT_FILTER_IDS.map((id) => ({
    id,
    label: AUDIT_FILTER_LABELS[id],
    filter: defs[id],
    value: AUDIT_FILTER_VALUES[id],
  }));
}

/** f.* 로 받는 열·연산자 (별칭이 없는 것만) */
const F_PARAM_DEFS = {
  actor: { kind: 'text' },
  target: { kind: 'text' },
  ip: { kind: 'text' },
  result: { kind: 'enum', options: RESULT_OPTIONS },
} as const satisfies Record<string, ColumnFilterDef>;

const ORDER: readonly string[] = AUDIT_FILTER_IDS;
const OP_RANK = { has: 0, eq: 1, in: 2, gte: 3, lte: 4 } as const;

function sortConditions(conds: FilterCondition[]): FilterCondition[] {
  return conds.sort(
    (a, b) => ORDER.indexOf(a.col) - ORDER.indexOf(b.col) || OP_RANK[a.op] - OP_RANK[b.op],
  );
}

/** 행위 값 목록: 쉼표 구분·trim·중복 제거, 값 100자·20개 한도. 선택지 소속은 보지 않는다(모르는 행위 = 결과 없음, 옛 동작과 같음) */
function parseActions(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const values = [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (values.length === 0 || values.length > FILTER_LIMITS.inMax) return undefined;
  if (values.some((value) => value.length > FILTER_LIMITS.valueMax)) return undefined;
  return values;
}

type Params = Record<string, string | string[] | undefined>;

function first(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

const DATE_DEF = { createdAt: { kind: 'date' } } as const satisfies Record<string, ColumnFilterDef>;
const TEXT_DEF = { actor: { kind: 'text' } } as const satisfies Record<string, ColumnFilterDef>;

/** 필터 → 표 툴바용 조건 목록 (별칭 포함, 열 순서) */
export function auditConditions(filter: Partial<AuditFilter>): FilterCondition[] {
  const conds: FilterCondition[] = [];
  if (filter.from) conds.push({ col: 'createdAt', op: 'gte', value: filter.from });
  if (filter.to) conds.push({ col: 'createdAt', op: 'lte', value: filter.to });
  if (filter.action && filter.action.length > 0)
    conds.push({ col: 'action', op: 'in', values: [...filter.action] });
  if (filter.actor) conds.push({ col: 'actor', op: 'has', value: filter.actor });
  conds.push(...(filter.filters ?? []));
  return sortConditions(conds);
}

/** 조건 목록 → 필터 조각 (별칭 열은 from·to·action·actor, 나머지는 filters). 없는 키는 undefined 로 덮어쓴다 */
export function auditFilterFromConditions(
  conds: readonly FilterCondition[],
): Pick<AuditFilter, 'from' | 'to' | 'action' | 'actor' | 'filters'> {
  const out: Pick<AuditFilter, 'from' | 'to' | 'action' | 'actor' | 'filters'> = {
    from: undefined,
    to: undefined,
    action: undefined,
    actor: undefined,
    filters: undefined,
  };
  const rest: FilterCondition[] = [];
  for (const cond of conds) {
    if (cond.col === 'createdAt' && cond.op === 'gte') out.from = cond.value;
    else if (cond.col === 'createdAt' && cond.op === 'lte') out.to = cond.value;
    else if (cond.col === 'action' && cond.op === 'in') out.action = [...cond.values];
    else if (cond.col === 'actor' && cond.op === 'has') out.actor = cond.value;
    else if (Object.hasOwn(F_PARAM_DEFS, cond.col)) rest.push(cond);
  }
  if (rest.length > 0) out.filters = sortConditions(rest);
  return out;
}

/**
 * URL 검색 파라미터 → 필터. 잘못된 값·화이트리스트 밖 열·연산자는 버린다(필터는 사용자가 URL 로 조작할 수 있음).
 * 조건 한도(10개)는 별칭 포함 전체에 열 순서로 적용한다.
 */
export function parseAuditFilterParams(params: Params): AuditFilter {
  const conds: FilterCondition[] = [];
  const from = first(params, 'from');
  const to = first(params, 'to');
  const actor = first(params, 'actor');
  const actions = parseActions(first(params, 'action'));
  const push = (cond: FilterCondition | undefined) => {
    if (cond) conds.push(cond);
  };
  if (from !== undefined)
    push(validateCondition({ col: 'createdAt', op: 'gte', value: from }, DATE_DEF));
  if (to !== undefined)
    push(validateCondition({ col: 'createdAt', op: 'lte', value: to }, DATE_DEF));
  if (actions) conds.push({ col: 'action', op: 'in', values: actions });
  if (actor !== undefined)
    push(validateCondition({ col: 'actor', op: 'has', value: actor }, TEXT_DEF));
  // f.* — 별칭 열의 has(사용자 포함)는 `actor` 로만 받는다
  for (const cond of parseFilterParams(params, F_PARAM_DEFS))
    if (!(cond.col === 'actor' && cond.op === 'has')) conds.push(cond);

  const limited = sortConditions(conds).slice(0, FILTER_LIMITS.conditionsMax);
  const parts = auditFilterFromConditions(limited);
  const page = Number(first(params, 'page'));
  const filter: AuditFilter = {
    from: parts.from,
    to: parts.to,
    action: parts.action,
    actor: parts.actor,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
  if (parts.filters) filter.filters = parts.filters;
  const sort = parseSortParams(params, AUDIT_SORT_IDS);
  return sort ? { ...filter, sort } : filter;
}

/** 열 필터·기존 필터(별칭)가 걸렸는가 — 정렬 제외 */
export function isAuditFiltered(filter: Partial<AuditFilter>): boolean {
  return auditConditions(filter).length > 0;
}

/**
 * 필터 → 쿼리스트링 (빈 값·1페이지는 생략해 URL 을 짧게 유지). 별칭(from·to·action·actor) → f.* → page, sort·dir 는 맨 뒤 (#32 §3).
 * 화면·페이지 링크·CSV href 가 같은 함수를 쓴다(CSV 가 화면과 같은 필터로 내보내짐).
 */
export function filterToQuery(filter: Partial<AuditFilter>): string {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.action && filter.action.length > 0) params.set('action', filter.action.join(','));
  if (filter.actor) params.set('actor', filter.actor);
  for (const [key, value] of serializeFilters(filter.filters ?? [])) params.append(key, value);
  if (filter.page && filter.page > 1) params.set('page', String(filter.page));
  const query = params.toString();
  return appendSortParams(query ? `?${query}` : '', filter.sort);
}
