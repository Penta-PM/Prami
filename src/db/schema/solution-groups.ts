import { integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

import { deletedAt, timestamps } from './columns';
import { items } from './items';
import { users } from './users';

/** 솔루션 그룹 (§4.3.7). 항목 가격은 저장하지 않고 견적 시점에 조회한다 */
export const solutionGroups = pgTable('solution_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  productFamily: text('product_family').notNull(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  deletedAt: deletedAt(),
  ...timestamps,
});

/** 그룹 구성 품목 (§4.3.7). UNIQUE(group_id, item_code) 를 복합 PK 로 표현 */
export const solutionGroupItems = pgTable(
  'solution_group_items',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => solutionGroups.id, { onDelete: 'cascade' }),
    itemCode: text('item_code')
      .notNull()
      .references(() => items.itemCode),
    defaultQty: integer('default_qty').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.itemCode] })],
);

export type SolutionGroup = typeof solutionGroups.$inferSelect;
export type SolutionGroupItem = typeof solutionGroupItems.$inferSelect;
