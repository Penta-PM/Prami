import { sql } from 'drizzle-orm';

import type { Tx } from '@/db/tx';
import { ITEM_KIND_OVERRIDES } from '@/lib/constants/item-kind-rules';

import { queryCount, queryRows } from './sql-rows';
import { recomputeSeriesSql, RESET_DELETED_ROWS_SQL } from './series';

/**
 * 가격정책 적용의 SQL 단계들 (§4.4.2 ~ §4.4.5). 모두 호출자의 트랜잭션 안에서 실행된다.
 */

export type ItemMergeMode = { mode: 'merge' | 'replace'; keptMajors: readonly string[] };

/**
 * 3단계: 품목조회 배치 → items upsert (정규화·판정 값은 업로드 시 스테이징에 계산돼 있다, PRAMI-003 §4.2).
 * 배치에 없는 master 품번은 stub 으로 되돌린다. 단 병합(merge)이면 이번 배치에 없는 대분류(keptMajors)의 행은 유지한다(§4.2.3).
 */
export async function applyItemBatch(
  tx: Tx,
  itemBatchId: string,
  salesBatchId: string,
  merge: ItemMergeMode,
): Promise<{ itemsApplied: number; unmappedItemStatus: number }> {
  const applied = await queryRows<{ item_code: string; source: string }>(
    tx,
    sql`
    insert into items (item_code, item_name, category_major, category_major_raw, category_mid,
                       category_minor, item_status, item_status_raw, item_kind, item_kind_rule,
                       base_unit, erp_registered_on, erp_modified_on, source, raw, import_batch_id)
    select s.item_code, s.item_name, s.category_major, s.category_major_raw, s.category_mid,
           s.category_minor, s.item_status, s.item_status_raw, s.item_kind, s.item_kind_rule,
           s.base_unit, s.erp_registered_on, s.erp_modified_on, 'master', s.raw, s.batch_id
    from stg_items s where s.batch_id = ${itemBatchId}
    on conflict (item_code) do update set
      item_name = excluded.item_name, category_major = excluded.category_major,
      category_major_raw = excluded.category_major_raw,
      category_mid = excluded.category_mid, category_minor = excluded.category_minor,
      item_status = excluded.item_status, item_status_raw = excluded.item_status_raw,
      item_kind = excluded.item_kind, item_kind_rule = excluded.item_kind_rule,
      base_unit = excluded.base_unit, erp_registered_on = excluded.erp_registered_on,
      erp_modified_on = excluded.erp_modified_on, source = 'master', raw = excluded.raw,
      import_batch_id = excluded.import_batch_id, updated_at = now()
    returning item_code, source::text as source`,
  );
  // 0006 트리거는 종류·상태·대분류가 빈 master 쓰기를 stub 으로 낮춘다(구 앱 호환). 신 앱 스테이징은 세 값이 항상 있으므로
  // 여기서 stub 이 나오면 검증 누락 — 조용히 넘기지 않고 적용 트랜잭션을 실패시킨다 (PR-1d 리뷰)
  const demoted = applied.filter((row) => row.source !== 'master').map((row) => row.item_code);
  if (demoted.length > 0) {
    throw new Error(
      `품목 적용 불변식 위반: 종류·상태·대분류가 빈 품번 ${demoted.length}건 (${demoted.slice(0, 5).join(', ')})`,
    );
  }
  const kept =
    merge.mode === 'merge' && merge.keptMajors.length > 0
      ? sql`and (category_major is null or category_major not in (${sql.join(
          merge.keptMajors.map((major) => sql`${major}`),
          sql`, `,
        )}))`
      : sql``;
  await tx.execute(sql`
    update items set source = 'stub', category_major = null, category_major_raw = null,
      category_mid = null, category_minor = null, item_status = null, item_status_raw = null,
      item_kind = null, item_kind_rule = null, base_unit = null, erp_registered_on = null,
      erp_modified_on = null, raw = null, import_batch_id = ${salesBatchId}, updated_at = now()
    where source = 'master'
      and item_code not in (select item_code from stg_items where batch_id = ${itemBatchId})
      ${kept}`);
  // 상태 매핑 불가는 업로드 행 오류라 오류 0 배치에서는 항상 0 (통계 호환 필드)
  const unmappedItemStatus = await queryCount(
    tx,
    sql`select count(*)::int as n from stg_items s
        where s.batch_id = ${itemBatchId} and s.item_status is null`,
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
    insert into items (item_code, item_name, source, import_batch_id)
    select distinct on (item_code) item_code, item_name, 'stub', ${salesBatchId}
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
      count(distinct sp.item_code) filter (where i.source = 'stub')::int as "missingItems",
      count(*) filter (where sp.source = 'erp'
        and sp.is_final_source <> sp.is_latest_in_series)::int as "finalSourceMismatch"
    from sales_prices sp
    left join items i on i.item_code = sp.item_code
    where sp.deleted_at is null`,
  );
  if (!row) throw new Error('통계를 집계하지 못했습니다');
  return row;
}

/** 정합 불변식 I-10 위반 표본 수 (§4.2.4 — 경고만, 적용은 막지 않는다) */
export const I10_SAMPLE_LIMIT = 20;

export type ItemApplyChecks = {
  i10Violations: number;
  i10Samples: string[];
  partMappingMismatch: { models: number; parts: number };
  overrideUnknown: string[];
};

/**
 * 적용 후 품목 점검 (경고): I-10(master 품번의 대분류 = 판매단가 제품군), 파츠 매핑 종류 불일치(모델이 본품이 아님 /
 * 파츠가 파츠가 아님 — 매핑은 지우지 않는다, §4.2.7 영향), 예외표의 품번이 품목 마스터에 없음(override_unknown_item).
 */
export async function collectItemChecks(tx: Tx): Promise<ItemApplyChecks> {
  const i10 = await queryRows<{ item_code: string }>(
    tx,
    sql`select distinct sp.item_code from sales_prices sp
        join items i on i.item_code = sp.item_code
        where sp.deleted_at is null and i.source = 'master'
          and i.category_major <> sp.product_family
        order by sp.item_code`,
  );
  const [mismatch] = await queryRows<{ models: number; parts: number }>(
    tx,
    sql`select
          count(*) filter (where coalesce(im.item_kind::text, '기타') <> '본품')::int as models,
          count(*) filter (where coalesce(ip.item_kind::text, '기타') <> '파츠')::int as parts
        from part_mappings pm
        left join items im on im.item_code = pm.model_item_code
        left join items ip on ip.item_code = pm.part_item_code`,
  );
  const codes = Object.keys(ITEM_KIND_OVERRIDES);
  const present = await queryRows<{ item_code: string }>(
    tx,
    sql`select item_code from items where source = 'master'
        and item_code in (${sql.join(
          codes.map((code) => sql`${code}`),
          sql`, `,
        )})`,
  );
  const found = new Set(present.map((row) => row.item_code));
  return {
    i10Violations: i10.length,
    i10Samples: i10.slice(0, I10_SAMPLE_LIMIT).map((row) => row.item_code),
    partMappingMismatch: { models: mismatch?.models ?? 0, parts: mismatch?.parts ?? 0 },
    overrideUnknown: codes.filter((code) => !found.has(code)),
  };
}
