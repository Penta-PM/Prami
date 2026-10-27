import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { NORMALIZED_OUR_COMPANY_NAMES } from '@/lib/procurement/our-company';

/**
 * server/procurement 공용 조각 — 페이지 계산·월 기간·금액 집계 식. 모든 금액은 원 단위 정수(number).
 * 합계는 SQL 에서 bigint 로 계산하고 number 로 받는다(조 단위까지 Number.MAX_SAFE_INTEGER 안).
 */

export const PROCUREMENT_PAGE_SIZE = 50;
export const PROCUREMENT_MAX_PAGE_SIZE = 200;

export type Paged<Row> = {
  rows: Row[];
  total: number;
  /** 1부터. 범위를 넘으면 마지막 페이지로 맞춘다 */
  page: number;
  pageCount: number;
  pageSize: number;
};

export function pageSizeOf(pageSize: number | undefined): number {
  if (pageSize === undefined) return PROCUREMENT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize 는 1 이상 정수');
  return Math.min(pageSize, PROCUREMENT_MAX_PAGE_SIZE);
}

/** 전체 건수 → 실제 페이지(1..pageCount)·offset */
export function pageWindow(total: number, requested: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const wanted = Number.isInteger(requested) && requested >= 1 ? requested : 1;
  const page = Math.min(wanted, pageCount);
  return { page, pageCount, offset: (page - 1) * pageSize };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** bigint·numeric 합계 → number (null → 0) */
export function sumAmount(expr: AnyColumn | SQL): SQL<number> {
  return sql<number>`coalesce(sum(${expr}), 0)::bigint`.mapWith(Number);
}

export function sumAmountWhere(expr: AnyColumn | SQL, condition: SQL): SQL<number> {
  return sql<number>`coalesce(sum(${expr}) filter (where ${condition}), 0)::bigint`.mapWith(Number);
}

export function countRows(): SQL<number> {
  return sql<number>`count(*)::int`.mapWith(Number);
}

export function countDistinct(expr: AnyColumn | SQL): SQL<number> {
  return sql<number>`count(distinct ${expr})::int`.mapWith(Number);
}

/**
 * 자사 제조사 판정 SQL — lib/procurement/our-company isOurManufacturer 와 같은 규칙·같은 목록.
 * 정규화: 공백(\s) 전부 제거 + `lower(... collate "C")`(ASCII 만 소문자). 항목마다 `like '%항목%'`(LIKE 특수문자 이스케이프)를 OR.
 * 회사명은 전부 파라미터로 넘긴다.
 */
export function isOursSql(manufacturer: AnyColumn | SQL): SQL {
  if (NORMALIZED_OUR_COMPANY_NAMES.length === 0) return sql`false`;
  const normalized = sql`lower(regexp_replace(coalesce(${manufacturer}, ''), ${String.raw`\s`}, '', 'g') collate "C")`;
  const matches = NORMALIZED_OUR_COMPANY_NAMES.map(
    (name) => sql`${normalized} like ${`%${escapeLike(name)}%`}`,
  );
  return sql`(${sql.join(matches, sql` or `)})`;
}

/** 분모 0 이면 null */
export function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/** 전년 대비 증감률. 전년 0 이면 null */
export function changeRate(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous;
}

// ── 월 ─────────────────────────────────────────────────────────────

/** 'YYYY-MM' */
export type MonthKey = string;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(value: string): { year: number; month: number } {
  const match = MONTH_RE.exec(value);
  if (!match) throw new RangeError(`월 형식이 아닙니다 (YYYY-MM): ${value}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function monthKey(year: number, month: number): MonthKey {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** n 달 뒤(음수면 앞) */
export function addMonths(value: MonthKey, n: number): MonthKey {
  const { year, month } = parseMonth(value);
  const index = year * 12 + (month - 1) + n;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** from..to (포함) 의 월 목록 */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const months: MonthKey[] = [];
  for (let current = from; current <= to; current = addMonths(current, 1)) months.push(current);
  return months;
}

/** 조회 기간 (월 단위, 양 끝 포함) */
export type MonthPeriod = { from: MonthKey; to: MonthKey };

export function assertPeriod(period: MonthPeriod): void {
  parseMonth(period.from);
  parseMonth(period.to);
  if (period.from > period.to) throw new RangeError('조회 기간의 시작 월이 끝 월보다 늦습니다');
}

/** 같은 달 범위의 1년 전 */
export function previousYearPeriod(period: MonthPeriod): MonthPeriod {
  return { from: addMonths(period.from, -12), to: addMonths(period.to, -12) };
}

/** date 열이 기간 안 (`>= from-01 and < (to+1)-01`) — 인덱스(deliveries_date_idx)를 쓰도록 열을 감싸지 않는다 */
export function inPeriod(column: AnyColumn | SQL, period: MonthPeriod): SQL {
  return sql`(${column} >= ${`${period.from}-01`}::date and ${column} < ${`${addMonths(period.to, 1)}-01`}::date)`;
}

/** date 열 → 'YYYY-MM' */
export function monthOf(column: AnyColumn | SQL): SQL<string> {
  return sql<string>`to_char(${column}, 'YYYY-MM')`;
}
