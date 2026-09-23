import { bigserial, index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditResultEnum } from './enums';
import { users } from './users';

/**
 * 감사 로그 (§4.3.10). append-only — 마이그레이션의 트리거가 UPDATE/DELETE 를 거부한다.
 * 변경 트랜잭션과 같은 배치에서 기록한다 (§4.2 원칙 4).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** 삭제된 사용자 대비 표시용 스냅샷 (이름/이메일 또는 'seed', 'system') */
    actorLabel: text('actor_label').notNull(),
    /** 예: price_policy.update, user.seed, auth.denied_domain */
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    targetLabel: text('target_label'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    reason: text('reason'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    result: auditResultEnum('result').notNull().default('success'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_created_at_idx').on(t.createdAt.desc()),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
