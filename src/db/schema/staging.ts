import { integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

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
    /** 파일 내 데이터 행 순서 (0-base, 헤더 제외) */
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
    categoryMajor: text('category_major'),
    categoryMid: text('category_mid'),
    categoryMinor: text('category_minor'),
    itemStatusRaw: text('item_status_raw'),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.rowIndex] })],
);
