import { isNull, sql, type SQL } from 'drizzle-orm';

import { salesPrices } from '@/db/schema';

/**
 * 가격 변동 공용 SQL (cost-ratio-price-change §2.4 → price-change-history-modal §2.1-2).
 * 가격 표(getPriceRows)와 변동 이력 모달(getPriceHistory)이 **같은 식**을 쓴다 — 클라이언트 재계산 금지(반올림 차이).
 */

/** 삭제 제외 (soft delete) — 표·직전가 윈도·이력 모두 같은 조건 */
export const LIVE_PRICE: SQL = isNull(salesPrices.deletedAt) as SQL;

/**
 * 직전가 윈도: 삭제 제외 행에서 계열별 lag 로 직전 적용시작일 행 판매가를 구해 `price_prev(id, previous_price)` 로 붙인다.
 * 계열 키 = 품번|단가유형|단가구분|화폐|거래처코드(series_key). 계열·적용시작일은 삭제 제외 유니크라 lag 순서가 결정적이다.
 * - 표: 인자 없음 = 필터·페이지 적용 **전** 전체 — 직전 행이 다른 페이지·필터 밖이어도 같은 값
 * - 이력: 한 계열로 좁힌다 — 같은 계열 안의 lag 라 전체 윈도와 값이 같다(인덱스 (series_key, effective_from))
 */
export function previousPrices(seriesKey?: string): SQL {
  const where =
    seriesKey === undefined
      ? LIVE_PRICE
      : sql`${LIVE_PRICE} and ${salesPrices.seriesKey} = ${seriesKey}`;
  return sql`(select ${salesPrices.id} as id,
    lag(${salesPrices.unitPrice}) over (partition by ${salesPrices.seriesKey} order by ${salesPrices.effectiveFrom}) as previous_price
  from ${salesPrices} where ${where}) as price_prev`;
}

/** previousPrices 와 id 로 조인할 때의 조건 */
export const PREVIOUS_PRICE_JOIN = sql`price_prev.id = ${salesPrices.id}`;

/** 직전가 (첫 시기 = NULL) */
export const PREVIOUS_PRICE = sql<string | null>`price_prev.previous_price`;

/**
 * 변동률: numeric 그대로 계산해 소수 1자리 round (Postgres numeric round = 0.5 는 0 에서 먼 쪽 → 절댓값 half-up).
 * 정렬도 같은 반올림 값으로 한다 — 화면에 보이는 값과 클라이언트 비교(number)가 서버 ORDER BY 와 같은 순서를 낸다.
 * 첫 시기·직전가 0 = NULL
 */
export const PRICE_CHANGE_RATE = sql<
  number | null
>`round((${salesPrices.unitPrice} - ${PREVIOUS_PRICE}) * 100 / nullif(${PREVIOUS_PRICE}, 0), 1)`;

/** 직전 대비 금액 (현재 − 직전, numeric 문자열). 첫 시기 = NULL */
export const PRICE_CHANGE_AMOUNT = sql<
  string | null
>`(${salesPrices.unitPrice} - ${PREVIOUS_PRICE})`;
