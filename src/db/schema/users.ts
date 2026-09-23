import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { citext, timestamps } from './columns';
import { createdViaEnum, userRoleEnum, userStatusEnum } from './enums';

/**
 * 사용자 (§4.3.10). Google 로그인 확정으로 비밀번호 컬럼은 두지 않는다.
 * Auth.js 는 JWT 전략을 쓰므로 accounts/sessions 테이블도 만들지 않는다.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  /** Google 프로필에 없음 → 관리자가 입력 */
  department: text('department'),
  role: userRoleEnum('role').notNull().default('USER'),
  status: userStatusEnum('status').notNull().default('active'),
  /** Google 계정 식별자(sub). 최초 로그인 시 기록 */
  googleSub: text('google_sub').unique(),
  avatarUrl: text('avatar_url'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdVia: createdViaEnum('created_via').notNull(),
  ...timestamps,
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
