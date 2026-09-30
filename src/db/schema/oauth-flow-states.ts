import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * OAuth 콜백 state 1회 소비 기록 (PRAMI-002 §4.6.2, PR-C QA L-2). state 원문은 저장하지 않고 SHA-256 해시만 둔다.
 * 콜백이 코드 교환 전에 `INSERT … ON CONFLICT DO NOTHING` 으로 원자적으로 소비한다 — 같은 state 재사용은 거부.
 * 만료(expires_at)가 지난 행은 콜백 때 기회적으로 지운다.
 */
export const oauthFlowStates = pgTable(
  'oauth_flow_states',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stateHash: text('state_hash').notNull(),
    vendor: text('vendor').notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.stateHash] }),
    index('oauth_flow_states_expires_at_idx').on(table.expiresAt),
  ],
);
