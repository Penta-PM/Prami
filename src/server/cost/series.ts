import { sql, type SQL } from 'drizzle-orm';

import type { DuplicateGroup } from '@/lib/imports/duplicates';
import { queryRows, type Executor } from '@/server/imports/sql-rows';

/**
 * 원가 계열 규칙 (§4.3.4·§4.4.7): 계열 키 = (자재번호, 단가유형, 단가구분, 화폐).
 * 품목상태가 없으므로 2단계(최신 판정)만 적용 — 최신 = 운영중, 그 외 = 미사용. DB 의 series_key 는 STORED 생성 컬럼.
 */
export type CostSeriesFields = {
  materialCode: string;
  priceType: string;
  priceCategory: string;
  currency: string;
};

export function costSeriesKey(row: CostSeriesFields): string {
  return [row.materialCode, row.priceType, row.priceCategory, row.currency].join('|');
}

export function recomputeCostSeriesSql(seriesKeys?: readonly string[]): SQL {
  const scope =
    seriesKeys && seriesKeys.length > 0
      ? sql`and series_key in (${sql.join(
          seriesKeys.map((key) => sql`${key}`),
          sql`, `,
        )})`
      : sql``;
  // r4 §4.4.7 2: 계열 내 ORDER BY effective_from DESC, source_row DESC — 같은 날짜면 원본에서 뒤에 있는 행이 우선(결정적).
  // manual 행은 source_row 가 NULL 이라 뒤로 가고, 마지막 보조 키 id 로 항상 전순서를 만든다.
  // 종료일 = 자기보다 앞 순위(rn 이 작은) 행 중 가장 이른 시작일 → 같은 날짜의 앞 행은 effective_to = 자기 effective_from(기간 0일).
  return sql`
    with ranked as (
      select id, series_key, effective_from,
             row_number() over (
               partition by series_key
               order by effective_from desc, source_row desc nulls last, id desc
             ) as rn
      from material_costs
      where deleted_at is null ${scope}
    )
    update material_costs m set
      effective_to = (
        select min(x.effective_from) from ranked x
        where x.series_key = r.series_key and x.rn < r.rn
      ),
      is_latest_in_series = (r.rn = 1),
      operation_status = (case when r.rn = 1 then '운영중' else '미사용' end)::operation_status
    from ranked r
    where m.id = r.id`;
}

export const RESET_DELETED_COSTS_SQL = sql`
  update material_costs
  set is_latest_in_series = false, operation_status = '미사용', effective_to = null
  where deleted_at is not null
    and (is_latest_in_series or operation_status <> '미사용' or effective_to is not null)`;

/** 불변식 I-2 (원가): 계열당 최신 행 정확히 1 */
export const COST_I2_VIOLATIONS_SQL = sql`
  select count(*)::int as n from (
    select series_key from material_costs
    where deleted_at is null
    group by series_key
    having sum(is_latest_in_series::int) <> 1
  ) t`;

/** r4 AC-40 ③: 적재된 원가에서 같은 계열·같은 적용시작일 그룹(삭제 제외). source_row 오름차순 */
export async function listCostDuplicateGroups(executor: Executor): Promise<DuplicateGroup[]> {
  return queryRows<DuplicateGroup>(
    executor,
    sql`
    select series_key as "seriesKey", effective_from::text as "effectiveFrom",
           array_agg(coalesce(source_row, 0) order by source_row nulls last, id) as "sourceRows",
           array_agg(unit_cost::text order by source_row nulls last, id) as "unitCosts"
    from material_costs
    where deleted_at is null
    group by series_key, effective_from
    having count(*) > 1
    order by series_key, effective_from`,
  );
}
