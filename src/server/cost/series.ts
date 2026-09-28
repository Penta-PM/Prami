import { sql, type SQL } from 'drizzle-orm';

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
  // 같은 계열·같은 적용시작일 행(원본 중복)은 파일 행 순서 = id 순으로 뒤 행이 우선한다(결정적 tie-break).
  // 종료일은 계열 안의 "다음 시작일"이므로 같은 날짜 중복끼리는 서로의 종료일이 되지 않는다. (Main 결정, PR-5)
  return sql`
    with ranked as (
      select id, series_key, effective_from,
             row_number() over (partition by series_key order by effective_from desc, id desc) as rn
      from material_costs
      where deleted_at is null ${scope}
    )
    update material_costs m set
      effective_to = (
        select min(x.effective_from) from material_costs x
        where x.series_key = r.series_key and x.deleted_at is null and x.effective_from > r.effective_from
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
