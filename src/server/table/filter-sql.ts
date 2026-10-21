import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

import {
  FILTER_LIMITS,
  hasControlChar,
  isOpAllowed,
  selectedCurrency,
  type ColumnFilterDef,
  type FilterCondition,
} from '@/lib/table/filter';
import { isEmptyText } from '@/server/pricing/sort-sql';

/**
 * 서버 표 열 필터 → WHERE 조각 (표 열 필터 스펙 §2.3). 클라이언트 술어 `matchesFilters`(lib/table/filter)와 같은 결과를 낸다.
 *
 * - 열 식은 #32 정렬 맵(sort-sql)과 같은 식을 표마다 `FilterSpec` 으로 넘긴다(화이트리스트). 스펙에 없는 열·그 열 종류에 없는 연산자는 무시.
 * - 사용자 값은 **항상 바인딩 파라미터**(drizzle `${value}`)로만 들어간다 — 열 식·연산자·키워드는 고정 SQL 조각.
 * - text `has`: `strpos(lower(x COLLATE "C"), lower($1 COLLATE "C")) > 0` (LIKE 이스케이프 불필요), `eq`: `lower(..) = lower($1 ..)`.
 *   "C" collation 의 lower 는 ASCII A-Z 만 바꾼다 = 클라이언트 asciiLowerText. 빈 값(null·''·공백만·'—')은 어떤 조건에도 맞지 않는다.
 * - enum `in`: `(x)::text in ($1, $2, …)` (검증된 enum 값). number/money `>=`·`<=` numeric, date `>=`·`<=` ISO date(표가 range 로 바꿀 수 있음).
 * - money: 통화 열(def.currencyCol) 조건이 하나로 정해졌을 때만 범위를 적용하고, 그때는 그 통화 행만(ASCII 대소문자 무시) 비교한다.
 *
 * 값의 형식·enum 소속·한도 검증은 URL 파싱(parseFilterParams + 표별 defs) 단계에서 끝난다. 여기서는 열·연산자 화이트리스트와
 * 값 길이·제어 문자만 다시 확인한다(데이터에서 온 enum 선택지 — 통화·행위 — 는 파서가 검증한다).
 */

type Expr = AnyColumn | SQL;

export type FilterSqlEntry = {
  def: ColumnFilterDef;
  /** 필터 대상 열 식 (정렬 맵과 같은 식) */
  expr: Expr;
  /** date 범위 식을 바꿀 때 (예: 감사 created_at 은 KST 날짜 경계). 기본: `expr >= $1::date` / `expr <= $1::date` */
  range?: (op: 'gte' | 'lte', value: string) => SQL;
  /** enum `in` 에서 이 값은 '빈 값'(null·''·공백만·'—', isEmptyText)과 맞는다 — 예: 가격 단가 유형의 PRICE_TYPE_NONE */
  emptyValue?: string;
};

export type FilterSpec = Readonly<Record<string, FilterSqlEntry>>;

/** 표의 defs(클라이언트 공용) + 서버 열 식 → FilterSpec. defs 에 있는데 식이 없는 열은 빠진다(필터 불가) */
export function buildFilterSpec<Id extends string>(
  defs: Readonly<Partial<Record<Id, ColumnFilterDef>>>,
  exprs: Readonly<Record<Id, Expr>>,
  options: {
    ranges?: Partial<Record<Id, FilterSqlEntry['range']>>;
    emptyValues?: Partial<Record<Id, string>>;
  } = {},
): FilterSpec {
  const spec: Record<string, FilterSqlEntry> = {};
  for (const id of Object.keys(defs) as Id[]) {
    const def = defs[id];
    if (!def || !Object.hasOwn(exprs, id)) continue;
    const range = options.ranges?.[id];
    const emptyValue = options.emptyValues?.[id];
    spec[id] = {
      def,
      expr: exprs[id],
      ...(range ? { range } : {}),
      ...(emptyValue !== undefined ? { emptyValue } : {}),
    };
  }
  return spec;
}

function notEmpty(expr: Expr): SQL {
  return sql`not ${isEmptyText(expr)}`;
}

function lowerC(expr: Expr | SQL): SQL {
  return sql`lower((${expr})::text collate "C")`;
}

function boundLowerC(value: string): SQL {
  return sql`lower(${value}::text collate "C")`;
}

function compare(op: 'gte' | 'lte'): SQL {
  return sql.raw(op === 'gte' ? '>=' : '<=');
}

/** 조건 하나 → SQL. 적용하지 않는 조건(화이트리스트 밖·통화 미선택 금액 범위)은 null */
function conditionSql(
  cond: FilterCondition,
  conds: readonly FilterCondition[],
  spec: FilterSpec,
): SQL | null {
  if (!Object.hasOwn(spec, cond.col)) return null;
  const { def, expr, range, emptyValue } = spec[cond.col] as FilterSqlEntry;
  if (!isOpAllowed(def, cond.op)) return null;
  if (cond.op === 'in') {
    if (def.kind !== 'enum') return null;
    const values = [
      ...new Set(
        cond.values.filter(
          (value) =>
            value.length > 0 && value.length <= FILTER_LIMITS.valueMax && !hasControlChar(value),
        ),
      ),
    ];
    if (values.length === 0 || values.length > FILTER_LIMITS.inMax) return null;
    const matchEmpty = emptyValue !== undefined && values.includes(emptyValue);
    const listed = matchEmpty ? values.filter((value) => value !== emptyValue) : values;
    const inList =
      listed.length > 0
        ? sql`(${expr})::text in (${sql.join(
            listed.map((value) => sql`${value}`),
            sql`, `,
          )})`
        : null;
    if (!matchEmpty) return inList;
    return inList ? sql`(${isEmptyText(expr)} or ${inList})` : isEmptyText(expr);
  }
  const value = cond.value;
  // 제어 문자(NUL 등)는 Postgres 가 거부해 500 이 되므로 파서를 거치지 않은 조건도 여기서 버린다 (BL-1)
  if (value.length === 0 || value.length > FILTER_LIMITS.valueMax || hasControlChar(value))
    return null;
  switch (cond.op) {
    case 'has':
      return sql`(${notEmpty(expr)} and strpos(${lowerC(expr)}, ${boundLowerC(value)}) > 0)`;
    case 'eq':
      return sql`(${notEmpty(expr)} and ${lowerC(expr)} = ${boundLowerC(value)})`;
    case 'gte':
    case 'lte': {
      const op = cond.op;
      if (def.kind === 'date') {
        return range ? range(op, value) : sql`(${expr}) ${compare(op)} ${value}::date`;
      }
      if (def.kind === 'money' && def.currencyCol) {
        const currency = selectedCurrency(conds, def);
        // 통화 미선택 — 범위 비활성 (클라이언트 matchesFilters 와 같음)
        if (currency === null) return null;
        const currencyEntry = Object.hasOwn(spec, def.currencyCol)
          ? spec[def.currencyCol]
          : undefined;
        if (!currencyEntry) return null;
        return sql`(${lowerC(currencyEntry.expr)} = ${boundLowerC(currency)} and (${expr}) ${compare(op)} ${value}::numeric)`;
      }
      return sql`(${expr}) ${compare(op)} ${value}::numeric`;
    }
  }
}

/** 조건 목록(AND) → WHERE 조각 목록. count·rows·CSV 가 같은 결과를 쓰도록 표마다 buildWhere 에 붙인다 */
export function filterSqlConditions(conds: readonly FilterCondition[], spec: FilterSpec): SQL[] {
  const out: SQL[] = [];
  for (const cond of conds.slice(0, FILTER_LIMITS.conditionsMax)) {
    const piece = conditionSql(cond, conds, spec);
    if (piece) out.push(piece);
  }
  return out;
}
