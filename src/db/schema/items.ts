import { isNotNull } from 'drizzle-orm';
import { index, jsonb, pgTable, pgView, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './columns';
import { itemKindEnum, itemStatusEnum } from './enums';
import { importBatches } from './imports';

/**
 * 품목 마스터 (§4.3.2, ERP 품목조회 파일). 파일 포맷 확정 전 최소 계약 + raw jsonb.
 * 판매단가에만 있는 품번은 임포트 적용 시 stub(raw.stub=true)으로 생성된다 (§4.3.6).
 */
export const items = pgTable(
  'items',
  {
    /** 품번. sales_prices.item_code 와 조인 키 */
    itemCode: text('item_code').primaryKey(),
    itemName: text('item_name').notNull(),
    categoryMajor: text('category_major'),
    categoryMid: text('category_mid'),
    categoryMinor: text('category_minor'),
    /** 파일 원문 라벨 → enum 매핑 (Q-02 확정 후) */
    itemStatus: itemStatusEnum('item_status'),
    /** 파일 원문 상태값 보존 */
    itemStatusRaw: text('item_status_raw'),
    /** 파생: 1차 규칙 category_mid='Parts' → 파츠 */
    itemKind: itemKindEnum('item_kind'),
    /** 파일의 나머지 컬럼 전체 (헤더→값) */
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    importBatchId: uuid('import_batch_id')
      .notNull()
      .references(() => importBatches.id),
    ...timestamps,
  },
  (t) => [
    index('items_category_idx').on(t.categoryMajor, t.categoryMid, t.categoryMinor),
    index('items_status_idx').on(t.itemStatus),
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
