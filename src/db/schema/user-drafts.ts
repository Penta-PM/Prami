import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 사용자별 입력 초안 (page-state-memory §2.1-1·§2.4). 초안(draft_key 화이트리스트)마다 1행.
 * - version: 초안 스키마 버전 — 읽을 때 현재 버전과 다르면 폐기한다
 * - data: zod 화이트리스트를 통과한 값만(최대 50KB). **원가 값은 넣지 않는다**(§2.1-3 — 순매출 계산기 원가 입력 제외)
 * - user_id 는 세션에서만 정하고, 사용자 삭제 시 함께 지운다(cascade). 마지막 수정 후 30일이 지나면 읽을 때 지운다(§2.4-4)
 */
export const userDrafts = pgTable(
  'user_drafts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    draftKey: text('draft_key').notNull(),
    version: integer('version').notNull(),
    data: jsonb('data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.userId, table.draftKey] })],
);

export type UserDraft = typeof userDrafts.$inferSelect;
