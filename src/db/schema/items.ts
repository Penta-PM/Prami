import { isNotNull, sql } from 'drizzle-orm';
import { check, date, index, jsonb, pgTable, pgView, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './columns';
import { itemKindEnum, itemSourceEnum, itemStatusEnum } from './enums';
import { importBatches } from './imports';

/**
 * 품목 마스터 (PRAMI-003 §4.2 — ERP 품목조회 39컬럼 확정). 원문은 `*_raw`·`raw`, 정규화·판정은 별도 컬럼(P-1).
 * 판매단가에만 있는 품번은 적용 시 `source='stub'` 행으로 생긴다. master 행은 종류·상태·대분류가 NOT NULL(CHECK).
 * 개인정보 컬럼(등록자·최종수정자·관리자)은 저장하지 않는다(§4.2.2).
 */
export const items = pgTable(
  'items',
  {
    /** 품번. sales_prices.item_code 와 조인 키 */
    itemCode: text('item_code').primaryKey(),
    itemName: text('item_name').notNull(),
    /** 정규화 제품군 (= sales_prices.product_family, §4.2.4) */
    categoryMajor: text('category_major'),
    /** ERP 품목대분류 원문 (예: D'Amo) */
    categoryMajorRaw: text('category_major_raw'),
    categoryMid: text('category_mid'),
    categoryMinor: text('category_minor'),
    /** 품목 상태 원문 → enum (ITEM_STATUS_MAP 확정, §4.2.6) */
    itemStatus: itemStatusEnum('item_status'),
    /** 파일 원문 상태값 보존 */
    itemStatusRaw: text('item_status_raw'),
    /** 판정 종류 (규칙표 K0~K7, §4.2.7) */
    itemKind: itemKindEnum('item_kind'),
    /** 적용된 판정 규칙 ID (K0~K7) */
    itemKindRule: text('item_kind_rule'),
    /** 기준단위 (견적·표시용) */
    baseUnit: text('base_unit'),
    erpRegisteredOn: date('erp_registered_on'),
    erpModifiedOn: date('erp_modified_on'),
    source: itemSourceEnum('source').notNull().default('master'),
    /** "처리=raw" 헤더 원문 (빈 값 키 생략) */
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    importBatchId: uuid('import_batch_id')
      .notNull()
      .references(() => importBatches.id),
    ...timestamps,
  },
  (t) => [
    index('items_category_idx').on(t.categoryMajor, t.categoryMid, t.categoryMinor),
    index('items_status_idx').on(t.itemStatus),
    check(
      'items_master_required_ck',
      sql`${t.source} <> 'master' or (${t.itemKind} is not null and ${t.itemStatus} is not null and ${t.categoryMajor} is not null)`,
    ),
  ],
);

/** 분류 옵션 (§4.3.5). 1차는 뷰, 성능 문제 시 테이블화 */
export const vCategoryOptions = pgView('v_category_options').as((qb) =>
  qb
    .selectDistinct({
      categoryMajor: items.categoryMajor,
      categoryMid: items.categoryMid,
      categoryMinor: items.categoryMinor,
    })
    .from(items)
    .where(isNotNull(items.categoryMajor)),
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
