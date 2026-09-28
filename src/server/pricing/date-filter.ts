import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import type { DateMode } from '@/features/pricing/filter';

export type DateFilterInput = { dateMode: DateMode; from?: string; to?: string };

/** effective_from / effective_to 컬럼 쌍 — 판매단가·원가가 같은 규칙을 쓴다 (R-14) */
export type EffectiveColumns = { effectiveFrom: PgColumn; effectiveTo: PgColumn };

/**
 * 날짜 필터 SQL (§4.5.2). 적용시작일 기준 = 시작일 범위(한쪽만 있으면 단방향),
 * 적용기간 기준 = 구간 겹침 `effective_from <= to AND (effective_to IS NULL OR effective_to > from)`.
 */
export function dateConditions(columns: EffectiveColumns, filter: DateFilterInput): SQL[] {
  const conditions: SQL[] = [];
  const { from, to } = filter;
  if (filter.dateMode === 'start') {
    if (from) conditions.push(sql`${columns.effectiveFrom} >= ${from}`);
    if (to) conditions.push(sql`${columns.effectiveFrom} <= ${to}`);
    return conditions;
  }
  if (to) conditions.push(sql`${columns.effectiveFrom} <= ${to}`);
  if (from) {
    conditions.push(sql`(${columns.effectiveTo} is null or ${columns.effectiveTo} > ${from})`);
  }
  return conditions;
}
