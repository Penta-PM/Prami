import {
  boolean,
  char,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { itemKindEnum, itemStatusEnum } from './enums';
import { importBatches } from './imports';
import { salesPriceSourceColumns } from './sales-prices';

/**
 * 판매단가 스테이징 (§4.3.3 parsed_rows). 배치 파싱 결과를 적용 전 미리보기·검증에 쓴다.
 * 컬럼은 sales_prices 원본 20컬럼과 동일 정의를 공유한다.
 */
export const stgSalesPrices = pgTable(
  'stg_sales_prices',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    /** 엑셀 행 번호 (1-base, 헤더 행 포함 기준) — 오류 목록·미리보기와 같은 번호 */
    rowIndex: integer('row_index').notNull(),
    ...salesPriceSourceColumns(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.rowIndex] })],
);

/** 품목조회 스테이징 (§4.3.3). 포맷 확정 전이라 분류·상태는 원문 텍스트, 나머지는 raw */
export const stgItems = pgTable(
  'stg_items',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    itemCode: text('item_code').notNull(),
    itemName: text('item_name').notNull(),
    /** 정규화 제품군 (PRAMI-003 §4.2.4) */
    categoryMajor: text('category_major'),
    categoryMajorRaw: text('category_major_raw'),
    categoryMid: text('category_mid'),
    categoryMinor: text('category_minor'),
    itemStatusRaw: text('item_status_raw'),
    itemStatus: itemStatusEnum('item_status'),
    itemKind: itemKindEnum('item_kind'),
    itemKindRule: text('item_kind_rule'),
    baseUnit: text('base_unit'),
    erpRegisteredOn: date('erp_registered_on'),
    erpModifiedOn: date('erp_modified_on'),
    /** 다중 파일 배치의 원본 파일명·엑셀 행 (row_index 는 배치 내 순번) */
    sourceFile: text('source_file'),
    fileRow: integer('file_row'),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.rowIndex] })],
);

/** 원가 스테이징 (§4.3.4 12컬럼). 적용(material_costs 반영)은 PR-5 */
export const stgMaterialCosts = pgTable(
  'stg_material_costs',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    materialCode: text('material_code').notNull(),
    materialName: text('material_name').notNull(),
    spec: text('spec'),
    unit: text('unit').notNull(),
    priceType: text('price_type').notNull(),
    priceCategory: text('price_category').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 18, scale: 2 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    isFinalSource: boolean('is_final_source').notNull(),
    remark: text('remark'),
    appliesToAllCustomers: boolean('applies_to_all_customers').notNull(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.rowIndex] })],
);

/** 파츠 매핑 스테이징 (§4.3.6 엑셀 등록). 적용(모델별 전체 교체)은 PR-6 */
export const stgPartMappings = pgTable(
  'stg_part_mappings',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    modelItemCode: text('model_item_code').notNull(),
    partItemCode: text('part_item_code').notNull(),
    modelName: text('model_name'),
    partName: text('part_name'),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.rowIndex] })],
);
