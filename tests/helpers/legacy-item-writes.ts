import { sql } from 'drizzle-orm';

import { queryRows, type Executor } from '@/server/imports/sql-rows';

/**
 * PRAMI-003 PR-1 QA M-1 — 직전 앱(main da1b186 = integration base 1605ad7)의 items 쓰기 SQL 을 그대로 옮긴 것.
 * 구 코드는 items.source 를 모른다. 롤백·마이그레이션 선적용 창에서 이 쓰기가 0005+ 스키마에서 동작해야 한다(P-4 expand).
 * 출처: 1605ad7 src/server/imports/apply-steps.ts (createMissingItemStubs·applyItemBatch), src/server/parts/mutations.ts (ensureItemStubs).
 * 구 코드가 바뀌지 않으므로 이 파일도 바꾸지 않는다(문구·컬럼 목록 그대로).
 */
const LEGACY_STATUS_CASE = sql`(case trim(s.item_status_raw) when '임시' then '임시' when '폐기' then '폐기' when '사용' then '사용' end)::item_status`;
const LEGACY_KIND_CASE = sql`(case when lower(trim(s.category_mid)) = 'parts' then '파츠' end)::item_kind`;

/** 구 createMissingItemStubs: 판매단가 품번 중 items 에 없는 품번을 raw.stub=true 로 (source 미지정) */
export async function legacyCreateMissingItemStubs(
  db: Executor,
  salesBatchId: string,
): Promise<void> {
  await db.execute(sql`
    insert into items (item_code, item_name, raw, import_batch_id)
    select distinct on (item_code) item_code, item_name, '{"stub": true}'::jsonb, ${salesBatchId}
    from sales_prices where deleted_at is null
    order by item_code, effective_from desc
    on conflict (item_code) do nothing`);
}

/** 구 parts ensureItemStubs: drizzle insert(items).values({ itemCode, itemName, importBatchId, raw }) 와 같은 SQL */
export async function legacyInsertPartStub(
  db: Executor,
  itemCode: string,
  itemName: string,
  importBatchId: string,
): Promise<void> {
  await db.execute(sql`
    insert into items (item_code, item_name, import_batch_id, raw)
    values (${itemCode}, ${itemName}, ${importBatchId}, '{"stub": true}'::jsonb)`);
}

/** 구 applyItemBatch: 스테이징 upsert(종류는 Parts → 파츠 외 NULL) 후, 파일에 없는 품번은 값을 비우고 raw.stub=true */
export async function legacyApplyItemBatch(
  db: Executor,
  itemBatchId: string,
  salesBatchId: string,
): Promise<void> {
  await db.execute(sql`
    insert into items (item_code, item_name, category_major, category_mid, category_minor,
                       item_status, item_status_raw, item_kind, raw, import_batch_id)
    select s.item_code, s.item_name, s.category_major, s.category_mid, s.category_minor,
           ${LEGACY_STATUS_CASE}, s.item_status_raw, ${LEGACY_KIND_CASE}, s.raw, s.batch_id
    from stg_items s where s.batch_id = ${itemBatchId}
    on conflict (item_code) do update set
      item_name = excluded.item_name, category_major = excluded.category_major,
      category_mid = excluded.category_mid, category_minor = excluded.category_minor,
      item_status = excluded.item_status, item_status_raw = excluded.item_status_raw,
      item_kind = excluded.item_kind, raw = excluded.raw,
      import_batch_id = excluded.import_batch_id, updated_at = now()
    returning item_code`);
  await db.execute(sql`
    update items set category_major = null, category_mid = null, category_minor = null,
      item_status = null, item_status_raw = null, item_kind = null,
      raw = '{"stub": true}'::jsonb, import_batch_id = ${salesBatchId}, updated_at = now()
    where item_code not in (select item_code from stg_items where batch_id = ${itemBatchId})
      and coalesce(raw->>'stub', 'false') <> 'true'`);
}

export type LegacyItemRow = {
  item_code: string;
  source: string;
  item_kind: string | null;
  item_status: string | null;
  category_major: string | null;
};

async function insertBatch(db: Executor, kind: string, sha: string): Promise<string> {
  const [batch] = await queryRows<{ id: string }>(
    db,
    sql`insert into import_batches (kind, file_name, file_sha256, file_size)
        values (${kind}::import_kind, ${`${sha}.xlsx`}, ${sha}, 1) returning id`,
  );
  return batch!.id;
}

/**
 * 신 앱이 적용해 둔 master 2건이 있는 DB 에서 구 앱의 세 쓰기 경로를 차례로 실행하고 items 를 돌려준다.
 * - PSALESNEW: 판매단가에만 있는 새 품번 → 구 stub 생성
 * - PPARTNEW: 파츠 매핑 저장 시 구 stub 생성
 * - 구 품목 배치: PMASTER1(Parts·사용·WAPPLES → 완전한 행), PLEGACYNEW(종류 NULL), PMASTER2 는 파일에 없음(값 비움)
 */
export async function runLegacyItemWrites(db: Executor, tag: string): Promise<LegacyItemRow[]> {
  const salesBatchId = await insertBatch(db, 'sales_price', `legacy-sales-${tag}`);
  const itemBatchId = await insertBatch(db, 'item_master', `legacy-items-${tag}`);
  await db.execute(sql`
    insert into items (item_code, item_name, category_major, item_status, item_kind, source, raw, import_batch_id)
    values ('PMASTER1', '신 앱 master 1', 'WAPPLES', '사용', '본품', 'master', '{}'::jsonb, ${itemBatchId}),
           ('PMASTER2', '신 앱 master 2', 'D.AMO', '폐기', '서비스', 'master', '{}'::jsonb, ${itemBatchId})`);
  await db.execute(sql`
    insert into sales_prices (source_id, product_family, item_code, item_name, unit, price_category,
      currency, has_core_price, unit_price, effective_from, applies_to_all_customers, is_final_source,
      base_core_count, unit_price_per_core, customer_code, source, import_batch_id)
    values (1, 'WAPPLES', 'PSALESNEW', '판매단가 신규 품번', 'EA', '정상판매', 'KRW', false, 1000,
      '2026-01-01', true, true, 1, 1000, 'ALL', 'erp', ${salesBatchId})`);

  await legacyCreateMissingItemStubs(db, salesBatchId);
  await legacyInsertPartStub(db, 'PPARTNEW', '파츠 매핑 신규 품번', salesBatchId);
  await db.execute(sql`
    insert into stg_items (batch_id, row_index, item_code, item_name, category_major, category_mid,
      category_minor, item_status_raw, raw)
    values (${itemBatchId}, 1, 'PMASTER1', '구 품목 파일 1', 'WAPPLES', 'Parts', null, '사용', '{}'::jsonb),
           (${itemBatchId}, 2, 'PLEGACYNEW', '구 품목 파일 2', 'WAPPLES', 'Model', null, '사용', '{}'::jsonb)`);
  await legacyApplyItemBatch(db, itemBatchId, salesBatchId);

  return queryRows<LegacyItemRow>(
    db,
    sql`select item_code, source::text as source, item_kind::text as item_kind,
               item_status::text as item_status, category_major
        from items order by item_code`,
  );
}

/** 구 앱 쓰기 이후 기대 상태: 완전한 행만 master, 나머지는 stub (0005 백필 규칙과 같은 기준) */
export const LEGACY_EXPECTED_ROWS: readonly LegacyItemRow[] = [
  {
    item_code: 'PLEGACYNEW',
    source: 'stub',
    item_kind: null,
    item_status: '사용',
    category_major: 'WAPPLES',
  },
  {
    item_code: 'PMASTER1',
    source: 'master',
    item_kind: '파츠',
    item_status: '사용',
    category_major: 'WAPPLES',
  },
  {
    item_code: 'PMASTER2',
    source: 'stub',
    item_kind: null,
    item_status: null,
    category_major: null,
  },
  {
    item_code: 'PPARTNEW',
    source: 'stub',
    item_kind: null,
    item_status: null,
    category_major: null,
  },
  {
    item_code: 'PSALESNEW',
    source: 'stub',
    item_kind: null,
    item_status: null,
    category_major: null,
  },
];
