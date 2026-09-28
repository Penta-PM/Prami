import { sql, type SQL } from 'drizzle-orm';

/**
 * 계열(series) 규칙 (§4.4.3, Q-04 가정 채택) — 키 정의는 이 파일 한 곳에서 관리한다.
 * 계열 키 = (품번, 단가유형, 단가구분, 화폐, 거래처코드). 단가유형 NULL 은 '' 로 취급해 별도 계열(R-5, Q-11).
 * DB 의 sales_prices.series_key 는 같은 식의 STORED 생성 컬럼(schema/sales-prices.ts)이며,
 * 두 정의가 같은 값을 내는지 테스트가 확인한다.
 */
export const SALES_SERIES_FIELDS = [
  'itemCode',
  'priceType',
  'priceCategory',
  'currency',
  'customerCode',
] as const;

export type SeriesFields = {
  itemCode: string;
  priceType: string | null;
  priceCategory: string;
  currency: string;
  customerCode: string;
};

export function salesSeriesKey(row: SeriesFields): string {
  return [
    row.itemCode,
    row.priceType ?? '',
    row.priceCategory,
    row.currency,
    row.customerCode,
  ].join('|');
}

export type SeriesInput = SeriesFields & { effectiveFrom: string };

export type SeriesResult = {
  seriesKey: string;
  /** 같은 계열의 다음 effective_from (배타적 종료일). null = 현재까지 */
  effectiveTo: string | null;
  isLatest: boolean;
};

/**
 * 순수 함수 버전 (검증·테스트용): 입력 순서대로 결과를 돌려준다.
 * 적용 경로는 아래 SQL(윈도우 함수 1문장)을 쓰고, 이 함수로 교차 검증한다.
 */
export function computeSeries(rows: readonly SeriesInput[]): SeriesResult[] {
  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = salesSeriesKey(row);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const results: SeriesResult[] = rows.map((row) => ({
    seriesKey: salesSeriesKey(row),
    effectiveTo: null,
    isLatest: false,
  }));
  for (const indexes of groups.values()) {
    const ordered = [...indexes].sort((a, b) =>
      rows[a]!.effectiveFrom.localeCompare(rows[b]!.effectiveFrom),
    );
    ordered.forEach((rowIndex, position) => {
      const next = ordered[position + 1];
      results[rowIndex] = {
        ...results[rowIndex]!,
        effectiveTo: next === undefined ? null : rows[next]!.effectiveFrom,
        isLatest: next === undefined,
      };
    });
  }
  return results;
}

/**
 * 2~4단계 재계산 SQL (§4.4.3). 삭제되지 않은 행만 계열에 참여한다.
 * - effective_to = 계열 내 다음 effective_from, is_latest = 최신 1행
 * - operation_status: 최신이 아니면 미사용(2단계), 최신이어도 품목상태 폐기면 미사용(4단계, R-08), 그 외 운영중
 * seriesKeys 를 주면 해당 계열만 재계산한다 (관리 화면 수동 등록/수정, PR-4).
 */
export function recomputeSeriesSql(seriesKeys?: readonly string[]): SQL {
  const scope =
    seriesKeys && seriesKeys.length > 0
      ? sql`and series_key in (${sql.join(
          seriesKeys.map((key) => sql`${key}`),
          sql`, `,
        )})`
      : sql``;
  return sql`
    with ranked as (
      select id, item_code,
             lead(effective_from) over (partition by series_key order by effective_from) as next_from,
             row_number() over (partition by series_key order by effective_from desc) as rn
      from sales_prices
      where deleted_at is null ${scope}
    )
    update sales_prices p set
      effective_to = r.next_from,
      is_latest_in_series = (r.rn = 1),
      operation_status = (case
        when r.rn <> 1 then '미사용'
        when i.item_status = '폐기' then '미사용'
        else '운영중'
      end)::operation_status
    from ranked r
    left join items i on i.item_code = r.item_code
    where p.id = r.id`;
}

/** 삭제된 행은 계열에서 빠진다: 최신 아님 · 미사용 · 종료일 없음 */
export const RESET_DELETED_ROWS_SQL = sql`
  update sales_prices
  set is_latest_in_series = false, operation_status = '미사용', effective_to = null
  where deleted_at is not null
    and (is_latest_in_series or operation_status <> '미사용' or effective_to is not null)`;
