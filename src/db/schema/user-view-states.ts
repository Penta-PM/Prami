import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/** 스크롤 위치 — 같은 조회 조건(query)으로 돌아왔을 때만 복원한다 (page-state-memory §2.3) */
export type ViewScroll = { query: string; top: number };

/**
 * 사용자별 화면 조회 상태 (page-state-memory §2.1-1·§2.2). 페이지(page_key 화이트리스트)마다 마지막 정규화 쿼리 1행.
 * - query: 그 페이지 파서를 통과한 정규화 쿼리스트링('?' 없음, 최대 2KB). '' = 빈 상태(필터 초기화 후)
 * - user_id 는 세션에서만 정하고, 사용자 삭제 시 함께 지운다(cascade). 유지 기간 무기한(§2.2-8)
 */
export const userViewStates = pgTable(
  'user_view_states',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageKey: text('page_key').notNull(),
    query: text('query').notNull().default(''),
    scroll: jsonb('scroll').$type<ViewScroll>(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.userId, table.pageKey] })],
);

export type UserViewState = typeof userViewStates.$inferSelect;
