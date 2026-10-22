// 클라이언트(필터 UI·표)에서도 파싱하므로 JIT(eval) 탐지를 끈 zod 를 쓴다 (CSP, PR-11a QA L-1)
import { z } from '@/lib/zod-jitless';
import { formatDate } from '@/lib/date-format';
import { formatAmount } from '@/lib/pricing/format';

import { isEmptySortValue, type MoneyValue, type SortValue } from './compare';

/**
 * 표 열 필터 (table-column-filter 스펙 §2.1·§2.2) — 연산자 모델·URL 코덱·zod 검증·클라이언트 술어·칩 표시.
 * 순수 모듈(React 없음): 서버(파싱·화이트리스트)와 클라이언트(술어·URL 갱신)가 같이 쓴다.
 *
 * - URL: `f.<colId>.<op>=<value>`, `in` 은 쉼표 구분. 열·연산자는 표마다 넘기는 `defs` 로만 받는다(화이트리스트).
 * - 한도·형식 오류(제어 문자 포함 — hasControlChar)는 그 조건만 버린다(§2.1-4). 같은 열+연산자가 여러 번 오면 마지막 값.
 * - 텍스트 비교는 #32 와 같은 ASCII 소문자화(`asciiLowerText`) — `toLowerCase`·`localeCompare` 금지(서버 `lower(x COLLATE "C")` 와 일치).
 */

export type FilterOp = 'has' | 'eq' | 'in' | 'gte' | 'lte';
export type ScalarFilterOp = Exclude<FilterOp, 'in'>;

export type FilterCondition =
  { col: string; op: 'in'; values: string[] } | { col: string; op: ScalarFilterOp; value: string };

export type FilterOption = { value: string; label: string };

export type ColumnFilterDef =
  | { kind: 'text' }
  | { kind: 'enum'; options: readonly FilterOption[] }
  | { kind: 'number' }
  /** currencyCol: 같은 열에 통화가 섞일 때 통화 열 id — 통화 조건이 하나로 정해졌을 때만 금액 범위가 활성 */
  | { kind: 'money'; currencyCol?: string }
  | { kind: 'date' };

export type FilterKind = ColumnFilterDef['kind'];

/** 열 종류별 허용 연산자. 첫 항목이 기본 연산자 */
export const OPS_BY_KIND = {
  text: ['has', 'eq'],
  enum: ['in'],
  number: ['gte', 'lte'],
  money: ['gte', 'lte'],
  date: ['gte', 'lte'],
} as const satisfies Record<FilterKind, readonly FilterOp[]>;

export const FILTER_LIMITS = {
  /** 값(또는 `in` 의 값 하나) 최대 글자 수 */
  valueMax: 100,
  /** `in` 값 최대 개수 */
  inMax: 20,
  /** 조건 최대 개수 */
  conditionsMax: 10,
} as const;

/** 표시·URL 정렬 순서 (열 순서 다음) */
export const OP_ORDER: readonly FilterOp[] = ['has', 'eq', 'in', 'gte', 'lte'];

export const FILTER_KEY_RE = /^f\.([A-Za-z]+)\.(has|eq|in|gte|lte)$/;
const FILTER_PREFIX = 'f.';
const COL_RE = /^[A-Za-z]+$/;

export function filterKey(col: string, op: FilterOp): string {
  return `${FILTER_PREFIX}${col}.${op}`;
}

export function isOpAllowed(def: ColumnFilterDef, op: FilterOp): boolean {
  return (OPS_BY_KIND[def.kind] as readonly FilterOp[]).includes(op);
}

// ── 텍스트 비교 ───────────────────────────────────────────────────────────

/** ASCII A-Z 만 소문자로 (compare.ts asciiLower 와 같은 범위). 'Ä'·'İ' 등 비ASCII 는 그대로 */
export function asciiLowerText(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x20));
}

// ── 값 검증 (zod) ─────────────────────────────────────────────────────────

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

/**
 * C0 제어 문자(U+0000–U+001F, 탭·줄바꿈 포함)나 DEL(U+007F)이 들어 있는가 (BL-1, #57 QA).
 * 필터 값·검색어 등 URL 문자열 파라미터에 있으면 형식 오류 — 그 조건(파라미터)만 버린다.
 * Postgres 는 text 에 NUL 을 받지 않아(22021) 그대로 바인딩하면 500 이 된다.
 */
export function hasControlChar(value: string): boolean {
  return CONTROL_CHAR_RE.test(value);
}

const textValue = z.string().trim().min(1).max(FILTER_LIMITS.valueMax);

/** 유한한 10진수(부호·소수 허용, 지수·16진수·공백·Infinity 불가) */
const numberValue = z
  .string()
  .trim()
  .max(FILTER_LIMITS.valueMax)
  .regex(/^-?\d+(\.\d+)?$/)
  .refine((value) => Number.isFinite(Number(value)));

/**
 * 실재하는 날짜만 (2025-02-30 불가). 앞뒤 공백은 지우고 검증(§7 Q1 A-a). 0000–0099 년은 거부한다(§7 Q1 A-d) —
 * Date.UTC 가 0–99 년을 1900–1999 로 해석해 아래 왕복 비교에서 떨어진다(현재 동작 유지, 단위 테스트로 고정)
 */
const dateValue = z.iso.date().refine((value) => {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
});

/**
 * 값 하나 검증 (§7 Q1 A): 제어 문자 → 형식 오류. 모든 종류 앞뒤 공백을 지운 뒤 검증하고, 100자 한도도 trim 뒤 길이로 센다
 * (`in` 은 언이스케이프 뒤 — splitInValues 가 먼저 푼다).
 */
function validateScalar(def: ColumnFilterDef, raw: string): string | undefined {
  if (hasControlChar(raw)) return undefined;
  const value = raw.trim();
  if (value.length > FILTER_LIMITS.valueMax) return undefined;
  const schema = def.kind === 'text' ? textValue : def.kind === 'date' ? dateValue : numberValue;
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * `in` 값 목록 URL 코덱 (스펙 §2.2 개정, Plan §7 — 백슬래시 이스케이프). 값 안의 `,` 는 `\,`, `\` 는 `\\` 로 쓰고,
 * 이스케이프되지 않은 `,` 가 구분자다. 기존 URL(값에 쉼표·백슬래시가 없던 것)은 그대로 같은 뜻.
 * 그 밖의 `\x`·끝에 홀로 남은 `\` 는 형식 오류 → undefined(그 조건만 버림).
 */
export function splitInValues(raw: string): string[] | undefined {
  const values: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (char === '\\') {
      const next = raw[i + 1];
      if (next !== ',' && next !== '\\') return undefined;
      current += next;
      i += 1;
    } else if (char === ',') {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

/** splitInValues 의 역 — 값 안의 `\` 와 `,` 를 이스케이프해 쉼표로 잇는다 */
export function joinInValues(values: readonly string[]): string {
  return values.map((value) => value.replace(/[\\,]/g, (char) => `\\${char}`)).join(',');
}

/**
 * `in` 값 목록 검증 (§7 Q1 A): 제어 문자 → 형식 오류. 각 값은 선택지에 그대로 있으면 그 값, 아니면 앞뒤 공백을 지운 값으로
 * 선택지를 찾는다(데이터에서 온 선택지가 공백을 품어도 정확히 맞춘 값은 그대로 통과). 100자 한도는 trim 뒤 길이,
 * 20개 한도는 중복 제거(조용히 합침) 뒤 개수로 센다.
 */
function validateIn(
  def: Extract<ColumnFilterDef, { kind: 'enum' }>,
  parts: readonly string[],
): string[] | undefined {
  if (parts.some(hasControlChar)) return undefined;
  const allowed = def.options.map((option) => option.value);
  if (allowed.length === 0) return undefined;
  const normalized = parts.map((part) => (allowed.includes(part) ? part : part.trim()));
  if (normalized.some((value) => value.length > FILTER_LIMITS.valueMax)) return undefined;
  const values = [...new Set(normalized)];
  if (values.length > FILTER_LIMITS.inMax) return undefined;
  const schema = z.array(z.enum(allowed as [string, ...string[]])).min(1);
  const result = schema.safeParse(values);
  return result.success ? result.data : undefined;
}

/** 조건 하나 검증·정규화(값 trim·`in` 중복 제거). 화이트리스트·한도·형식 위반이면 undefined */
export function validateCondition(
  cond: FilterCondition,
  defs: Readonly<Record<string, ColumnFilterDef>>,
): FilterCondition | undefined {
  if (!COL_RE.test(cond.col) || !Object.hasOwn(defs, cond.col)) return undefined;
  const def = defs[cond.col] as ColumnFilterDef;
  if (!isOpAllowed(def, cond.op)) return undefined;
  if (cond.op === 'in') {
    if (def.kind !== 'enum') return undefined;
    // 한도는 언이스케이프한 값 기준 (Plan §7) — trim·중복 제거 뒤 (validateIn)
    const values = validateIn(def, cond.values);
    return values ? { col: cond.col, op: 'in', values } : undefined;
  }
  const value = validateScalar(def, cond.value);
  return value === undefined ? undefined : { col: cond.col, op: cond.op, value };
}

// ── URL 코덱 ──────────────────────────────────────────────────────────────

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

/** 같은 키가 여러 번이면 마지막 값 */
function lastValues(params: Params): Map<string, string> {
  const out = new Map<string, string>();
  if (params instanceof URLSearchParams) {
    for (const [key, value] of params) out.set(key, value);
    return out;
  }
  for (const [key, value] of Object.entries(params)) {
    const last = Array.isArray(value) ? value[value.length - 1] : value;
    if (last !== undefined) out.set(key, last);
  }
  return out;
}

function sortConditions(
  conds: FilterCondition[],
  defs: Readonly<Record<string, ColumnFilterDef>>,
): FilterCondition[] {
  const colOrder = Object.keys(defs);
  return conds.sort(
    (a, b) =>
      colOrder.indexOf(a.col) - colOrder.indexOf(b.col) ||
      OP_ORDER.indexOf(a.op) - OP_ORDER.indexOf(b.op),
  );
}

/**
 * URL 검색 파라미터 → 조건 목록. `defs` 에 없는 열·그 열에 허용되지 않은 연산자·키 형식 위반은 무시,
 * 한도·형식 위반 조건만 버린다. 순서: defs 키 순 → 연산자 순(OP_ORDER). 조건 수 한도는 이 순서로 앞에서부터.
 */
export function parseFilterParams(
  params: Params,
  defs: Readonly<Record<string, ColumnFilterDef>>,
): FilterCondition[] {
  const conds: FilterCondition[] = [];
  for (const [key, raw] of lastValues(params)) {
    const match = FILTER_KEY_RE.exec(key);
    if (!match) continue;
    const col = match[1] as string;
    const op = match[2] as FilterOp;
    let candidate: FilterCondition;
    if (op === 'in') {
      // 백슬래시 이스케이프를 풀어 값 목록으로 (형식 오류면 그 조건만 버림, 빈 조각 'a,,b' 는 enum 검증에서 탈락)
      const values = splitInValues(raw);
      if (!values) continue;
      candidate = { col, op, values };
    } else {
      candidate = { col, op, value: raw };
    }
    const cond = validateCondition(candidate, defs);
    if (cond) conds.push(cond);
  }
  return sortConditions(conds, defs).slice(0, FILTER_LIMITS.conditionsMax);
}

/** 조건 → [키, 값] 목록 (URLSearchParams 인코딩 전 원문). `in` 값은 joinInValues 로 이스케이프, 잘못된 열 id 의 조건은 건너뛴다 */
export function serializeFilters(conds: readonly FilterCondition[]): [string, string][] {
  const out: [string, string][] = [];
  for (const cond of conds) {
    if (!COL_RE.test(cond.col)) continue;
    if (cond.op === 'in') {
      if (cond.values.length === 0) continue;
      out.push([filterKey(cond.col, 'in'), joinInValues(cond.values)]);
    } else {
      out.push([filterKey(cond.col, cond.op), cond.value]);
    }
  }
  return out;
}

function toSearchParams(params: Params | string): URLSearchParams {
  if (typeof params === 'string') return new URLSearchParams(params);
  if (params instanceof URLSearchParams) return new URLSearchParams(params);
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) out.append(key, item);
  }
  return out;
}

/**
 * 현재 파라미터의 `f.*` 를 모두 conds 로 바꾼 새 URLSearchParams. `page` 는 지운다(= 1페이지, 1페이지는 URL 에서 생략하는 기존 관례).
 * 그 밖의 파라미터(family·q 등)는 순서대로 유지하고, `sort`·`dir` 는 맨 뒤(#32 §3).
 */
export function withFilters(
  current: Params | string,
  conds: readonly FilterCondition[],
): URLSearchParams {
  const source = toSearchParams(current);
  const out = new URLSearchParams();
  const tail: [string, string][] = [];
  for (const [key, value] of source) {
    if (key.startsWith(FILTER_PREFIX) || key === 'page') continue;
    if (key === 'sort' || key === 'dir') tail.push([key, value]);
    else out.append(key, value);
  }
  for (const [key, value] of serializeFilters(conds)) out.append(key, value);
  // sort 다음 dir 순서로 고정
  for (const name of ['sort', 'dir'])
    for (const [key, value] of tail) if (key === name) out.append(key, value);
  return out;
}

/** withFilters 결과를 '' 또는 '?a=b' 쿼리스트링으로 */
export function withFiltersQuery(
  current: Params | string,
  conds: readonly FilterCondition[],
): string {
  const query = withFilters(current, conds).toString();
  return query ? `?${query}` : '';
}

// ── 통화 규칙 (§2.1-2) ────────────────────────────────────────────────────

/** 통화 열 조건이 하나의 통화로 정해졌으면 그 통화(`in` 값 1개 또는 `eq`), 아니면 null */
export function selectedCurrency(
  conds: readonly FilterCondition[],
  def: ColumnFilterDef,
): string | null {
  if (def.kind !== 'money' || !def.currencyCol) return null;
  let currency: string | null = null;
  for (const cond of conds) {
    if (cond.col !== def.currencyCol) continue;
    if (cond.op === 'in') {
      if (cond.values.length !== 1) return null;
      currency = cond.values[0] as string;
    } else if (cond.op === 'eq') {
      currency = cond.value;
    }
  }
  return currency;
}

/** 금액 범위 조건이 유효한가. money 가 아니거나 통화 열이 없으면 true, 통화가 섞이는 열이면 통화가 하나로 정해졌을 때만 true */
export function isMoneyRangeActive(
  conds: readonly FilterCondition[],
  def: ColumnFilterDef,
): boolean {
  if (def.kind !== 'money' || !def.currencyCol) return true;
  return selectedCurrency(conds, def) !== null;
}

// ── 클라이언트 술어 ───────────────────────────────────────────────────────

export type FilterAccessorValue = SortValue | readonly string[];
export type FilterAccessors<T> = Readonly<Record<string, (row: T) => FilterAccessorValue>>;

function isMoney(value: unknown): value is MoneyValue {
  return (
    typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value)
  );
}

/** 비어 있지 않은 값 목록(배열 열은 원소별, 스칼라는 1개) */
function present(value: FilterAccessorValue): SortValue[] {
  const list: SortValue[] = Array.isArray(value) ? [...value] : [value as SortValue];
  return list.filter((item) => !isEmptySortValue(item));
}

function toAmount(value: SortValue): number {
  if (typeof value === 'number') return value;
  if (isMoney(value)) return value.amount;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? Number.NaN : Number(trimmed);
  }
  return Number.NaN;
}

/** 행 값 → KST 기준 YYYY-MM-DD (ISO 날짜 문자열은 그대로). 해석 불가면 null */
function toIsoDay(value: SortValue): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : formatDate(date);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : formatDate(value);
  if (typeof value === 'number') return Number.isFinite(value) ? formatDate(new Date(value)) : null;
  return null;
}

function inRange(op: 'gte' | 'lte', actual: number | string, bound: number | string): boolean {
  return op === 'gte' ? actual >= bound : actual <= bound;
}

function matchesOne<T>(
  row: T,
  cond: FilterCondition,
  def: ColumnFilterDef,
  accessor: (row: T) => FilterAccessorValue,
  currency: string | null,
): boolean {
  const values = present(accessor(row));
  if (values.length === 0) return false;
  switch (cond.op) {
    case 'has': {
      const needle = asciiLowerText(cond.value);
      return values.some((v) => asciiLowerText(String(v)).includes(needle));
    }
    case 'eq': {
      const target = asciiLowerText(cond.value);
      return values.some((v) => asciiLowerText(String(v)) === target);
    }
    case 'in':
      return values.some((v) => cond.values.includes(String(v)));
    case 'gte':
    case 'lte': {
      const op = cond.op;
      if (def.kind === 'date') {
        return values.some((v) => {
          const day = toIsoDay(v);
          return day !== null && inRange(op, day, cond.value);
        });
      }
      const bound = Number(cond.value);
      return values.some((v) => {
        if (
          currency !== null &&
          !(isMoney(v) && asciiLowerText(v.currency) === asciiLowerText(currency))
        )
          return false;
        const amount = toAmount(v);
        return !Number.isNaN(amount) && inRange(op, amount, bound);
      });
    }
  }
}

/**
 * 행이 모든 조건(AND)을 만족하는가. 빈 값(isEmptySortValue)은 어떤 조건에도 맞지 않는다.
 * money 범위는 통화 규칙상 비활성이면 무시하고, 활성이면 행 통화(MoneyValue.currency, 없으면 통화 열 접근자)가 선택 통화와 같을 때만 금액을 비교한다.
 * defs 에 없는 열·접근자가 없는 열의 조건은 맞지 않음으로 본다(파싱이 화이트리스트를 거치므로 정상 흐름에선 없음).
 */
export function matchesFilters<T>(
  row: T,
  conds: readonly FilterCondition[],
  accessors: FilterAccessors<T>,
  defs: Readonly<Record<string, ColumnFilterDef>>,
): boolean {
  for (const cond of conds) {
    const def = Object.hasOwn(defs, cond.col) ? defs[cond.col] : undefined;
    const accessor = Object.hasOwn(accessors, cond.col) ? accessors[cond.col] : undefined;
    if (!def || !accessor) return false;
    let currency: string | null = null;
    if (def.kind === 'money' && def.currencyCol && (cond.op === 'gte' || cond.op === 'lte')) {
      currency = selectedCurrency(conds, def);
      if (currency === null) continue; // 통화 미선택 — 범위 비활성
      const currencyCol = def.currencyCol;
      const read = accessors[currencyCol];
      // 금액 접근자가 숫자만 주면 통화 열 값으로 MoneyValue 를 만든다
      const wrapped = (r: T): FilterAccessorValue => {
        const value = accessor(r);
        if (isMoney(value) || Array.isArray(value)) return value;
        const cur = read?.(r);
        return typeof cur === 'string'
          ? { amount: toAmount(value as SortValue), currency: cur }
          : value;
      };
      if (!matchesOne(row, cond, def, wrapped, currency)) return false;
      continue;
    }
    if (!matchesOne(row, cond, def, accessor, currency)) return false;
  }
  return true;
}

/** 필터 결과(원래 순서 유지). 조건이 없으면 복사본 */
export function filterRows<T>(
  rows: readonly T[],
  conds: readonly FilterCondition[],
  accessors: FilterAccessors<T>,
  defs: Readonly<Record<string, ColumnFilterDef>>,
): T[] {
  if (conds.length === 0) return rows.slice();
  return rows.filter((row) => matchesFilters(row, conds, accessors, defs));
}

// ── 칩 표시 ───────────────────────────────────────────────────────────────

export type ConditionGroup = { col: string; conds: FilterCondition[] };

/** 열별로 묶기(처음 나온 열 순서, 묶음 안은 OP_ORDER). 칩 하나 = 열 하나, × 는 그 열 조건 전부 해제 */
export function groupConditions(conds: readonly FilterCondition[]): ConditionGroup[] {
  const groups = new Map<string, FilterCondition[]>();
  for (const cond of conds) {
    const list = groups.get(cond.col);
    if (list) list.push(cond);
    else groups.set(cond.col, [cond]);
  }
  return [...groups].map(([col, list]) => ({
    col,
    conds: list.sort((a, b) => OP_ORDER.indexOf(a.op) - OP_ORDER.indexOf(b.op)),
  }));
}

/** 열 하나의 조건을 뺀 목록 (칩 ×) */
export function withoutColumn(conds: readonly FilterCondition[], col: string): FilterCondition[] {
  return conds.filter((cond) => cond.col !== col);
}

function boundText(def: ColumnFilterDef, value: string): string {
  return def.kind === 'date' ? value : formatAmount(value);
}

/** 조건 본문(열 이름 제외). 범위는 gte·lte 를 함께 받으면 `a ~ b`. 빠른 필터 바의 버튼 요약·접근성 이름도 쓴다 */
export function describeConditionBody(
  conds: readonly FilterCondition[],
  def: ColumnFilterDef,
): string {
  const parts: string[] = [];
  let gte: string | undefined;
  let lte: string | undefined;
  for (const cond of conds) {
    switch (cond.op) {
      case 'has':
        parts.push(`"${cond.value}" 포함`);
        break;
      case 'eq':
        parts.push(`"${cond.value}" 같음`);
        break;
      case 'in': {
        const options = def.kind === 'enum' ? def.options : [];
        parts.push(
          cond.values
            .map((value) => options.find((option) => option.value === value)?.label ?? value)
            .join(', '),
        );
        break;
      }
      case 'gte':
        gte = boundText(def, cond.value);
        break;
      case 'lte':
        lte = boundText(def, cond.value);
        break;
    }
  }
  if (gte !== undefined && lte !== undefined) parts.push(`${gte} ~ ${lte}`);
  else if (gte !== undefined) parts.push(def.kind === 'date' ? `${gte} ~` : `≥ ${gte}`);
  else if (lte !== undefined) parts.push(def.kind === 'date' ? `~ ${lte}` : `≤ ${lte}`);
  return parts.join(' · ');
}

/** 칩 문구 `<열>: <조건>` — 예: `품목명: "abc" 포함`, `상태: 운영중, 미사용`, `판매가: ≥ 1,000`, `적용시작일: 2025-01-01 ~ 2025-12-31` */
export function describeCondition(
  cond: FilterCondition | readonly FilterCondition[],
  label: string,
  def: ColumnFilterDef,
): string {
  const list: readonly FilterCondition[] = Array.isArray(cond) ? cond : [cond as FilterCondition];
  return `${label}: ${describeConditionBody(list, def)}`;
}
