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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { deletedAt, timestamps } from './columns';
import { operationStatusEnum, sourceKindEnum } from './enums';
import { importBatches } from './imports';
import { users } from './users';

/**
 * 판매단가 엑셀 20컬럼 원본 블록 (§4.3.1). 엑셀 헤더 순서를 그대로 따르고
 * 타입은 프로파일링 결과에 맞춘 최소 변환만 한다 (값·의미 변경 없음).
 * sales_prices 와 스테이징 stg_sales_prices 가 공유한다.
 */
export const salesPriceSourceColumns = () => ({
  /** 1 `id` — 파일 내 1..N. 재임포트 시 달라질 수 있어 PK 로 쓰지 않음 */
  sourceId: integer('source_id').notNull(),
  /** 2 `제품군` */
  productFamily: text('product_family').notNull(),
  /** 3 `품번` — 조인·매핑 키 (trim) */
  itemCode: text('item_code').notNull(),
  /** 4 `품명` — trim, NBSP 정규화는 검색 인덱스 표현식에서만 */
  itemName: text('item_name').notNull(),
  /** 5 `규격` — 빈 셀→NULL */
  spec: text('spec'),
  /** 6 `단위` */
  unit: text('unit').notNull(),
  /** 7 `단가유형` — 빈 셀→NULL (원본 11행) */
  priceType: text('price_type'),
  /** 8 `단가구분` */
  priceCategory: text('price_category').notNull(),
  /** 9 `화폐` — 대문자 */
  currency: char('currency', { length: 3 }).notNull(),
  /** 10 `코어단가유무` — Y→true, N→false */
  hasCorePrice: boolean('has_core_price').notNull(),
  /** 11 `단가` — 음수는 행 오류 */
  unitPrice: numeric('unit_price', { precision: 18, scale: 2 }).notNull(),
  /** 12 `비고` — 숫자 셀은 문자열화 */
  remark: text('remark'),
  /** 13 `적용시작일` */
  effectiveFrom: date('effective_from').notNull(),
  /** 14 `전체고객적용여부` */
  appliesToAllCustomers: boolean('applies_to_all_customers').notNull(),
  /** 15 `최종여부` — ERP 값 그대로 보존 (시스템 산정값은 is_latest_in_series) */
  isFinalSource: boolean('is_final_source').notNull(),
  /** 16 `기준코어수` */
  baseCoreCount: integer('base_core_count').notNull(),
  /** 17 `단가(1코어)` */
  unitPricePerCore: numeric('unit_price_per_core', { precision: 18, scale: 2 }).notNull(),
  /** 18 `거래처코드` — 문자열화(선행 0 보존). '0' = 전체 고객 */
  customerCode: text('customer_code').notNull(),
  /** 19 `고객 번호` — 빈 셀→NULL */
  customerNo: text('customer_no'),
  /** 20 `고객명` — 빈 셀→NULL */
  customerName: text('customer_name'),
});

/** §4.4.3 계열 키 = 품번|단가유형|단가구분|화폐|거래처코드 */
export const SALES_PRICE_SERIES_KEY_SQL = sql`"item_code" || '|' || coalesce("price_type", '') || '|' || "price_category" || '|' || "currency" || '|' || "customer_code"`;

/** 판매단가 (§4.3.1). 원본 20컬럼 + 파생·메타 블록 */
export const salesPrices = pgTable(
  'sales_prices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ...salesPriceSourceColumns(),

    // ── 파생·메타 ─────────────────────────────────────────────────────────
    /** 임포트 행 = erp, 관리 화면 등록 = manual */
    source: sourceKindEnum('source').notNull(),
    /** erp 행만 */
    importBatchId: uuid('import_batch_id').references(() => importBatches.id),
    /** 계열 키 (STORED generated) */
    seriesKey: text('series_key').notNull().generatedAlwaysAs(SALES_PRICE_SERIES_KEY_SQL),
    /** 파생: 같은 계열의 다음 effective_from (배타). NULL = 현재까지 */
    effectiveTo: date('effective_to'),
    /** 파생: 계열 내 최신 여부 */
    isLatestInSeries: boolean('is_latest_in_series').notNull().default(false),
    /** 파생: §4.4.3 규칙 (품목상태 폐기 반영) */
    operationStatus: operationStatusEnum('operation_status').notNull().default('미사용'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sales_prices_series_effective_uq')
      .on(t.seriesKey, t.effectiveFrom)
      .where(sql`"deleted_at" is null`),
    index('sales_prices_item_code_idx').on(t.itemCode),
    index('sales_prices_family_effective_idx').on(t.productFamily, t.effectiveFrom),
    index('sales_prices_series_effective_idx').on(t.seriesKey, t.effectiveFrom),
    index('sales_prices_operation_status_idx').on(t.operationStatus),
    index('sales_prices_item_name_trgm_idx').using('gin', t.itemName.op('gin_trgm_ops')),
  ],
);

export type SalesPrice = typeof salesPrices.$inferSelect;
export type NewSalesPrice = typeof salesPrices.$inferInsert;
