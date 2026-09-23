import { boolean, date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { deletedAt, timestamps } from './columns';
import { users } from './users';

/** 공지사항 (§4.3.9). 디자인의 작성자 입력(author_name)을 유지하고 작성 계정도 함께 기록 */
export const notices = pgTable(
  'notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    authorName: text('author_name').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    isImportant: boolean('is_important').notNull().default(false),
    publishedAt: date('published_at').notNull().defaultNow(),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [index('notices_published_idx').on(t.publishedAt.desc())],
);

export type Notice = typeof notices.$inferSelect;
export type NewNotice = typeof notices.$inferInsert;
