import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { deletedAt, timestamps } from './columns';
import { operationStatusEnum, sourceKindEnum } from './enums';
import { importBatches } from './imports';
import { users } from './users';

/** §4.3.4 계열 키 = 자재번호|단가유형|단가구분|화폐 */
export const MATERIAL_COST_SERIES_KEY_SQL = sql`"material_code" || '|' || "price_type" || '|' || "price_category" || '|' || "currency"`;

/**
 * 원가 — 구매단가등록 12컬럼 1:1 (§4.3.4). server/cost/* 만 조회한다.
 * 어떤 공개 쿼리도 이 테이블을 조인하지 않는다 (§4.2 원칙 3).
 */
export const materialCosts = pgTable(
  'material_costs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    // ── 엑셀 12컬럼 원본 블록 (헤더 순서) ────────────────────────────────
    /** 1 `자재번호` */
    materialCode: text('material_code').notNull(),
    /** 2 `자재명` */
    materialName: text('material_name').notNull(),
    /** 3 `규격` */
    spec: text('spec'),
    /** 4 `단위` */
    unit: text('unit').notNull(),
    /** 5 `단가유형` */
    priceType: text('price_type').notNull(),
    /** 6 `단가구분` */
    priceCategory: text('price_category').notNull(),
    /** 7 `화폐` */
    currency: char('currency', { length: 3 }).notNull(),
    /** 8 `단가` */
    unitCost: numeric('unit_cost', { precision: 18, scale: 2 }).notNull(),
    /** 9 `적용시작일` */
    effectiveFrom: date('effective_from').notNull(),
    /** 10 `최종여부` */
    isFinalSource: boolean('is_final_source').notNull(),
    /** 11 `비고` */
    remark: text('remark'),
    /** 12 `전체고객적용여부` */
    appliesToAllCustomers: boolean('applies_to_all_customers').notNull(),

    // ── 파생·메타 ─────────────────────────────────────────────────────────
    source: sourceKindEnum('source').notNull(),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id),
    seriesKey: text('series_key').notNull().generatedAlwaysAs(MATERIAL_COST_SERIES_KEY_SQL),
    effectiveTo: date('effective_to'),
    isLatestInSeries: boolean('is_latest_in_series').notNull().default(false),
    operationStatus: operationStatusEnum('operation_status').notNull().default('미사용'),
    /** 파생 — Q-03: 자재번호 접두 규칙 또는 별도 매핑표 */
    productFamily: text('product_family'),
    /** r4: ERP 원본 파일의 데이터 행 번호(헤더 다음 행 = 1). erp 행은 NOT NULL, manual 은 NULL. 같은 날짜 tie-break 근거로만 쓴다 */
    sourceRow: integer('source_row'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [
    // r4 §4.3.4: 원본 ERP 파일에 같은 계열·적용시작일 행이 있어(1:1 보존) UNIQUE 를 두지 않는다 — 수동 등록·수정의
    // 중복은 앱(server/cost/mutations)에서 검사한다. 판매단가(sales_prices)의 부분 UNIQUE 는 그대로 (Main 결정, PR-5)
    index('material_costs_series_effective_idx').on(t.seriesKey, t.effectiveFrom, t.sourceRow),
    index('material_costs_material_code_idx').on(t.materialCode),
    index('material_costs_family_effective_idx').on(t.productFamily, t.effectiveFrom),
  ],
);

export type MaterialCost = typeof materialCosts.$inferSelect;
export type NewMaterialCost = typeof materialCosts.$inferInsert;
