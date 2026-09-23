import { bigserial, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './columns';
import { importBatches } from './imports';
import { items } from './items';
import { users } from './users';

/**
 * 파츠 매핑 (§4.3.6). 본품 품번 ↔ 장착 가능 파츠 품번.
 * 저장 시 모델 단위 전체 교체 (delete where model → insert all) 를 트랜잭션으로 수행한다.
 */
export const partMappings = pgTable(
  'part_mappings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    modelItemCode: text('model_item_code')
      .notNull()
      .references(() => items.itemCode),
    partItemCode: text('part_item_code')
      .notNull()
      .references(() => items.itemCode),
    sortOrder: integer('sort_order').notNull().default(0),
    /** 엑셀 등록 시 */
    importBatchId: uuid('import_batch_id').references(() => importBatches.id),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique('part_mappings_model_part_uq').on(t.modelItemCode, t.partItemCode),
    index('part_mappings_model_idx').on(t.modelItemCode),
  ],
);

export type PartMapping = typeof partMappings.$inferSelect;
