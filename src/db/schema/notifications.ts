import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 앱 내 알림 (#31 §4, 0008). 사용자별 행 fan-out — 브로드캐스트도 수신자마다 한 행이다.
 * - type 은 pgEnum 이 아닌 text (코드 상수 NOTIFICATION_TYPES). type 추가에 ALTER 가 필요 없다.
 * - link 컬럼은 두지 않는다. 이동 경로는 서버의 notificationHref(type, refId) 가 계산한다(open redirect 차단).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    refType: text('ref_type'),
    refId: text('ref_id'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('notifications_user_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
    check('notifications_title_len_ck', sql`char_length(${t.title}) <= 200`),
    check('notifications_body_len_ck', sql`${t.body} is null or char_length(${t.body}) <= 500`),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
