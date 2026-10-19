import 'server-only';

import { sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { queryRows } from '@/server/imports/sql-rows';

import { assertCostAccess, type CostAccess } from './access-token';
import { CANDIDATE_FAMILY_SQL } from './item-links';

/**
 * H/W 원가 비중 (스펙 cost-ratio-price-change §2.2). **원가 금액은 돌려주지 않는다**(비율·사유·원가 적용일만). DB 에 저장하지 않는다.
 * - 대상 행: 단가유형 '정상판매'(원문 그대로 비교) + 품목이 원가 매핑(cost_item_links)에 있고 **매핑 후보 범위 안**(본품 +
 *   대상 제품군 분류, Plan Q1 A — 범위 밖 링크는 쓰지 않는다). 그 밖의 행은 결과에 넣지 않는다(화면 '—', 툴팁 없음).
 * - 원가: 매핑된 자재번호의 표준구매원가·일반·삭제 제외, 가격 행과 **같은 화폐**,
 *   `원가.effective_from <= 가격.effective_from < 원가.effective_to(NULL = 무한)`. 같은 날짜 중복은 effective_from 최신 →
 *   source_row 최대. 이전 원가로 대체하지 않는다(해당 시기 원가가 없으면 '—').
 * - 비중 = 원가 / 판매가 × 100, 소수 1자리 반올림(half-up — 양수라 PG numeric round 와 같다).
 * - 사유: 판매가 0 → 'zero-price' / 같은 화폐 원가 없음 + 다른 화폐 원가는 있음 → 'currency' / 그 시기 원가 없음 → 'no-cost'.
 */
export type CostRatioReason = 'no-cost' | 'zero-price' | 'currency';
export type CostRatio =
  { costRatio: number; costFrom: string } | { costRatio: null; reason: CostRatioReason };

const NORMAL_PRICE_TYPE = '정상판매';
const COST_PRICE_TYPE = '표준구매원가';
const COST_PRICE_CATEGORY = '일반';
/** 한 번에 계산하는 행 수 상한 — 화면은 현재 페이지(50행)만 보낸다 */
export const COST_RATIO_MAX_IDS = 200;

type Row = {
  id: number;
  unit_price: string;
  same_cost: string | null;
  same_from: string | null;
  other_currency: boolean;
};

export async function getCostRatios(
  access: CostAccess,
  db: Db,
  priceRowIds: readonly number[],
): Promise<Record<number, CostRatio>> {
  assertCostAccess(access, 'read');
  const ids = [...new Set(priceRowIds.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(
    0,
    COST_RATIO_MAX_IDS,
  );
  if (ids.length === 0) return {};
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  // 같은 화폐 원가 1건(시기 포함 + tie-break)과, 다른 화폐 원가가 그 시기에 있는지만 본다. 금액은 비율 계산에만 쓰고 내보내지 않는다
  const rows = await queryRows<Row>(
    db,
    sql`
      select sp.id,
             sp.unit_price::text as unit_price,
             same.unit_cost::text as same_cost,
             same.effective_from::text as same_from,
             exists (
               select 1 from material_costs mc2
               where mc2.material_code = link.material_code
                 and mc2.deleted_at is null
                 and mc2.price_type = ${COST_PRICE_TYPE}
                 and mc2.price_category = ${COST_PRICE_CATEGORY}
                 and mc2.currency <> sp.currency
                 and mc2.effective_from <= sp.effective_from
                 and (mc2.effective_to is null or sp.effective_from < mc2.effective_to)
             ) as other_currency
      from sales_prices sp
      join cost_item_links link on link.item_code = sp.item_code
      join items on items.item_code = sp.item_code
      left join lateral (
        select mc.unit_cost, mc.effective_from
        from material_costs mc
        where mc.material_code = link.material_code
          and mc.deleted_at is null
          and mc.price_type = ${COST_PRICE_TYPE}
          and mc.price_category = ${COST_PRICE_CATEGORY}
          and mc.currency = sp.currency
          and mc.effective_from <= sp.effective_from
          and (mc.effective_to is null or sp.effective_from < mc.effective_to)
        order by mc.effective_from desc, mc.source_row desc nulls last, mc.id desc
        limit 1
      ) same on true
      where sp.id in (${idList})
        and sp.deleted_at is null
        and sp.price_type = ${NORMAL_PRICE_TYPE}
        and items.item_kind = '본품'
        and (${CANDIDATE_FAMILY_SQL}) is not null
    `,
  );
  const result: Record<number, CostRatio> = {};
  for (const row of rows) {
    const price = Number(row.unit_price);
    if (!(price > 0)) {
      result[row.id] = { costRatio: null, reason: 'zero-price' };
    } else if (row.same_cost === null || row.same_from === null) {
      result[row.id] = { costRatio: null, reason: row.other_currency ? 'currency' : 'no-cost' };
    } else {
      result[row.id] = {
        costRatio: roundHalfUp1((Number(row.same_cost) / price) * 100),
        costFrom: row.same_from,
      };
    }
  }
  return result;
}

/** 소수 1자리 half-up. 부동소수 오차(예: 12.25 → 12.249999…)를 막으려고 1e-9 여유를 둔다 */
export function roundHalfUp1(value: number): number {
  return Math.floor(value * 10 + 0.5 + 1e-9) / 10;
}
