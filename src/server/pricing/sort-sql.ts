import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

import type { SortDir } from '@/lib/table/compare';
import type { SortState } from '@/lib/table/sort-param';

/**
 * 서버 정렬 ORDER BY 조각 (#32 스펙 §2·§3) — 클라이언트 `src/lib/table/compare.ts` 와 같은 순서를 낸다.
 * 모든 식은 Drizzle 컬럼 참조·고정 SQL 로만 만든다. 사용자 문자열은 여기 들어오지 않는다(정렬 id 는 화이트리스트 맵의 키).
 *
 * - 텍스트: `lower(x COLLATE "C") COLLATE "C"` — lower 의 입력에도 "C" 를 걸어야 ASCII A-Z 만 소문자가 된다
 *   (DB 기본 collation 이 en_US 등이면 `lower(x)` 는 'Ä' 같은 비ASCII 도 바꿔 클라이언트 asciiLower 와 어긋난다).
 *   "C" 비교 = UTF-8 바이트 순 = 코드포인트 순.
 * - 빈 값(null·''·'—'·공백만, compare.ts isEmptySortValue)은 방향과 관계없이 맨 뒤: NULL 로 바꿔 NULLS LAST.
 * - 숫자·날짜·상태(CASE 서수)는 그대로 + NULLS LAST.
 */

type Expr = AnyColumn | SQL;

/** 방향 키워드는 고정 SQL 조각 — 사용자 입력이 아니다 */
function direction(dir: SortDir): SQL {
  return dir === 'desc' ? sql.raw('desc') : sql.raw('asc');
}

/** 값 그대로 정렬 + NULLS LAST (숫자·날짜·서수) */
export function byValue(expr: Expr, dir: SortDir): SQL {
  return sql`${expr} ${direction(dir)} nulls last`;
}

/** btrim 대상 공백: 스페이스·탭·LF·CR·FF·VT·NBSP (JS String.prototype.trim 의 실사용 범위) */
const TRIM_CHARS = sql.raw(String.raw`E' \t\n\r\f\x0B\u00A0'`);

/** 클라이언트 isEmptySortValue 와 같은 빈 값 판정 (null·''·공백만·'—'). 열 필터(server/table/filter-sql)도 쓴다 */
export function isEmptyText(expr: Expr): SQL {
  return sql`coalesce(btrim((${expr})::text, ${TRIM_CHARS}), '') in ('', '—')`;
}

/**
 * 텍스트 정렬 키: ASCII 만 소문자로 바꾼 코드포인트 순. 빈 값은 NULL 로 바꿔 NULLS LAST —
 * 빈 값끼리는 같은 값(클라이언트처럼 원래 순서 = 뒤의 기본 정렬 tie-breaker 순)으로 남는다.
 */
export function byText(expr: Expr, dir: SortDir): SQL[] {
  return [
    sql`lower((case when ${isEmptyText(expr)} then null else (${expr})::text end) collate "C") collate "C" ${direction(dir)} nulls last`,
  ];
}

/** 금액: 통화로 먼저 묶고(compareText) 같은 통화 안에서 금액순 — 클라이언트처럼 방향이 비교 전체에 걸린다 */
export function byMoney(currency: Expr, amount: Expr, dir: SortDir): SQL[] {
  return [...byText(currency, dir), byValue(amount, dir)];
}

/** 상태 정의 순서 → CASE 서수. 목록에 없는 값은 뒤(NULL → NULLS LAST) — 상태 열은 enum 이라 실제로는 생기지 않는다 */
export function byStatus(expr: Expr, order: readonly string[], dir: SortDir): SQL[] {
  const cases = sql.join(
    order.map((value, index) => sql`when ${value} then ${sql.raw(String(index))}`),
    sql` `,
  );
  return [sql`(case (${expr})::text ${cases} end) ${direction(dir)} nulls last`];
}

/** 정렬 맵 → ORDER BY. 정렬이 없으면 기본 정렬만, 있으면 고른 키 뒤에 기본 정렬 전체(끝은 id)를 tie-breaker 로 붙인다 */
export function buildOrderBy<Id extends string>(
  sort: SortState<Id> | undefined,
  map: Record<Id, (dir: SortDir) => SQL[]>,
  defaults: SQL[],
): SQL[] {
  // 맵 조회는 hasOwn 으로만 — 파서가 걸렀더라도 '__proto__' 같은 키가 들어와 함수가 아닌 값을 부르지 않게
  if (!sort || !Object.hasOwn(map, sort.id)) return defaults;
  return [...map[sort.id](sort.dir), ...defaults];
}
