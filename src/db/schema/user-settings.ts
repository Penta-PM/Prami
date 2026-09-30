import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 사용자별 챗봇 기본값 (PRAMI-002 §4.10). 벤더·모델은 앱에서 레지스트리·모델 상수로 검증한다.
 */
export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  chatDefaultVendor: text('chat_default_vendor'),
  chatDefaultModel: text('chat_default_model'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type UserSettings = typeof userSettings.$inferSelect;
