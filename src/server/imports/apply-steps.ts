import { sql, type SQL } from 'drizzle-orm';

import type { Tx } from '@/db/tx';
import { ITEM_STATUS_MAP } from '@/lib/constants/item-status';

import { queryCount, queryRows } from './sql-rows';
import { recomputeSeriesSql, RESET_DELETED_ROWS_SQL } from './series';

/**
 * 가격정책 적용의 SQL 단계들 (§4.4.2 ~ §4.4.5). 모두 호출자의 트랜잭션 안에서 실행된다.
 */

/** ITEM_STATUS_MAP 을 SQL CASE 로 옮긴다 (원문 라벨 → enum, 매핑 불가 → NULL) */
function itemStatusCaseSql(): SQL {
  const branches = Object.entries(ITEM_STATUS_MAP).map(
    ([label, status]) => sql`when ${label} then ${status}`,
  );
  return sql`(case trim(s.item_status_raw) ${sql.join(branches, sql` `)} end)::item_status`;
}

const ITEM_KIND_CASE = sql`(case when lower(trim(s.category_mid)) = 'parts' then '파츠' end)::item_kind`;

/** 3단계: 품목조회 배치 → items 전량 교체(upsert) 후, 파일에 없는 품번은 stub 으로 되돌린다 */
export async function applyItemBatch(
  tx: Tx,
  itemBatchId: string,
  salesBatchId: string,
): Promise<{ itemsApplied: number; unmappedItemStatus: number }> {
  const applied = await queryRows<{ item_code: string }>(
    tx,
    sql`
    insert into items (item_code, item_name, category_major, category_mid, category_minor,
                       item_status, item_status_raw, item_kind, raw, import_batch_id)
    select s.item_code, s.item_name, s.category_major, s.category_mid, s.category_minor,
           ${itemStatusCaseSql()}, s.item_status_raw, ${ITEM_KIND_CASE}, s.raw, s.batch_id
    from stg_items s where s.batch_id = ${itemBatchId}
    on conflict (item_code) do update set
      item_name = excluded.item_name, category_major = excluded.category_major,
      category_mid = excluded.category_mid, category_minor = excluded.category_minor,
      item_status = excluded.item_status, item_status_raw = excluded.item_status_raw,
      item_kind = excluded.item_kind, raw = excluded.raw,
      import_batch_id = excluded.import_batch_id, updated_at = now()
    returning item_code`,
  );
  await tx.execute(sql`
    update items set category_major = null, category_mid = null, category_minor = null,
      item_status = null, item_status_raw = null, item_kind = null,
      raw = '{"stub": true}'::jsonb, import_batch_id = ${salesBatchId}, updated_at = now()
    where item_code not in (select item_code from stg_items where batch_id = ${itemBatchId})
      and coalesce(raw->>'stub', 'false') <> 'true'`);
  const unmappedItemStatus = await queryCount(
    tx,
    sql`select count(*)::int as n from stg_items s
        where s.batch_id = ${itemBatchId} and s.item_status_raw is not null
          and ${itemStatusCaseSql()} is null`,
  );
  return { itemsApplied: applied.length, unmappedItemStatus };
}

/** 1단계: ERP 행 전량 교체 — 스테이징의 각 행을 적용시작일 그대로 적재 (§4.4.2, R-05) */
export async function loadSalesBatch(tx: Tx, salesBatchId: string): Promise<number> {
  await tx.execute(sql`delete from sales_prices where source = 'erp'`);
  const inserted = await queryRows<{ id: number }>(
    tx,
    sql`
    insert into sales_prices (source_id, product_family, item_code, item_name, spec, unit, price_type,
      price_category, currency, has_core_price, unit_price, remark, effective_from,
      applies_to_all_customers, is_final_source, base_core_count, unit_price_per_core,
      customer_code, customer_no, customer_name, source, import_batch_id)
    select source_id, product_family, item_code, item_name, spec, unit, price_type,
      price_category, currency, has_core_price, unit_price, remark, effective_from,
      applies_to_all_customers, is_final_source, base_core_count, unit_price_per_core,
      customer_code, customer_no, customer_name, 'erp', batch_id
    from stg_sales_prices where batch_id = ${salesBatchId}
    order by row_index
    returning id`,
  );
  return inserted.length;
}

export type SupersededManualRow = { id: number; series_key: string; effective_from: string };

/**
 * 5단계: 같은 (series_key, effective_from) 에 ERP 행이 들어오면 ERP 우선 — manual 행은 soft delete (§4.4.5, Q-08).
 * 부분 UNIQUE 인덱스는 deleted_at IS NULL 행만 보므로, ERP 적재 전에 manual 을 먼저 지워야 한다.
 */
export async function supersedeManualRows(
  tx: Tx,
  salesBatchId: string,
): Promise<SupersededManualRow[]> {
  return queryRows<SupersededManualRow>(
    tx,
    sql`
    update sales_prices m set deleted_at = now(), updated_at = now()
    where m.source = 'manual' and m.deleted_at is null
      and exists (
        select 1 from stg_sales_prices s
        where s.batch_id = ${salesBatchId}
          and s.effective_from = m.effective_from
          and s.item_code || '|' || coalesce(s.price_type, '') || '|' || s.price_category || '|' ||
              s.currency || '|' || s.customer_code = m.series_key
      )
    returning m.id, m.series_key, m.effective_from::text as effective_from`,
  );
}

/** 3단계 보조: 품목 마스터에 없는 판매단가 품번을 stub 으로 만든다 (§4.3.6) */
export async function createMissingItemStubs(tx: Tx, salesBatchId: string): Promise<void> {
  await tx.execute(sql`
    insert into items (item_code, item_name, raw, import_batch_id)
    select distinct on (item_code) item_code, item_name, '{"stub": true}'::jsonb, ${salesBatchId}
    from sales_prices where deleted_at is null
    order by item_code, effective_from desc
    on conflict (item_code) do nothing`);
}

/** 2·4단계: 계열별 최신·종료일·운영상태 재계산 (전체) */
export async function recomputeAll(tx: Tx): Promise<void> {
  await tx.execute(recomputeSeriesSql());
  await tx.execute(RESET_DELETED_ROWS_SQL);
}

export type ApplyCounts = {
  erpRows: number;
  manualPreserved: number;
  seriesCount: number;
  latestCount: number;
  operatingCount: number;
  discardedForced: number;
  missingItems: number;
  finalSourceMismatch: number;
};

/** 적용 후 통계 (run.stats, AC-20/21 증거) */
export async function collectCounts(tx: Tx): Promise<ApplyCounts> {
  const [row] = await queryRows<Record<keyof ApplyCounts, number>>(
    tx,
    sql`
    select
      count(*) filter (where sp.source = 'erp')::int as "erpRows",
      count(*) filter (where sp.source = 'manual')::int as "manualPreserved",
      count(distinct sp.series_key)::int as "seriesCount",
      count(*) filter (where sp.is_latest_in_series)::int as "latestCount",
      count(*) filter (where sp.operation_status = '운영중')::int as "operatingCount",
      count(*) filter (where sp.is_latest_in_series and i.item_status = '폐기')::int as "discardedForced",
      count(distinct sp.item_code) filter (where i.raw->>'stub' = 'true')::int as "missingItems",
      count(*) filter (where sp.source = 'erp'
        and sp.is_final_source <> sp.is_latest_in_series)::int as "finalSourceMismatch"
    from sales_prices sp
    left join items i on i.item_code = sp.item_code
    where sp.deleted_at is null`,
  );
  if (!row) throw new Error('통계를 집계하지 못했습니다');
  return row;
}
