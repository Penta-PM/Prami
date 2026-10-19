import 'server-only';

import { and, eq, ne, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { users, type User } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { AppError } from '@/lib/result';
import { AUDIT_ACTIONS, writeAudit, type RequestMeta } from '@/server/audit/log';
import { isAllowedDomain } from '@/server/auth/callbacks';
import { invalidateSessionUser } from '@/server/auth/session-user';
import { insertForUser } from '@/server/notifications/audience';
import { NOTIFICATION_REF, notificationContent } from '@/server/notifications/types';

import {
  createUserSchema,
  deactivateUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type DeactivateUserInput,
  type UpdateUserInput,
} from './schemas';

/**
 * 사용자 관리 (§4.5.10, ADMIN 전용). 권한 검사는 호출자(runAction)가 하고,
 * 여기서는 규칙 검사·변경·감사 로그를 한 트랜잭션으로 처리한다.
 */
export type MutationContext = {
  handle: DbHandle;
  actor: { id: string; email: string };
  meta: RequestMeta;
  allowedDomains: readonly string[];
};

const AUDITED_FIELDS = ['name', 'department', 'role', 'status'] as const;

type AuditedField = (typeof AUDITED_FIELDS)[number];

/** 바뀐 필드만 before/after 로 남긴다 (AC-05: before.role, after.role) */
export function diffUser(
  before: Pick<User, AuditedField>,
  after: Pick<User, AuditedField>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const changed = AUDITED_FIELDS.filter((field) => before[field] !== after[field]);
  if (changed.length === 0) return null;
  return {
    before: Object.fromEntries(changed.map((field) => [field, before[field]])),
    after: Object.fromEntries(changed.map((field) => [field, after[field]])),
  };
}

async function findUser(tx: Tx, id: string): Promise<User> {
  const [row] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', '사용자를 찾을 수 없습니다');
  return row;
}

/** 다른 활성 ADMIN 이 남는지 (마지막 관리자를 강등·비활성화하면 아무도 관리할 수 없게 된다) */
async function hasOtherActiveAdmin(tx: Tx, excludeId: string): Promise<boolean> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'active'), ne(users.id, excludeId)));
  return (row?.count ?? 0) > 0;
}

async function guardAdminLockout(tx: Tx, ctx: MutationContext, target: User, next: User) {
  const losesAdmin =
    target.role === 'ADMIN' &&
    target.status === 'active' &&
    (next.role !== 'ADMIN' || next.status !== 'active');
  if (!losesAdmin) return;
  if (target.id === ctx.actor.id) {
    throw new AppError('VALIDATION', '본인의 관리자 권한은 해제하거나 비활성화할 수 없습니다');
  }
  if (!(await hasOtherActiveAdmin(tx, target.id))) {
    throw new AppError('VALIDATION', '마지막 관리자는 해제하거나 비활성화할 수 없습니다');
  }
}

export async function createUser(ctx: MutationContext, raw: CreateUserInput): Promise<User> {
  const input = createUserSchema.parse(raw);
  if (!isAllowedDomain(input.email, ctx.allowedDomains)) {
    throw new AppError('VALIDATION', '허용된 도메인의 이메일만 등록할 수 있습니다', {
      email: [`허용 도메인: ${ctx.allowedDomains.join(', ')}`],
    });
  }
  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) throw new AppError('CONFLICT', '이미 등록된 이메일입니다');
    const created = firstRow(
      await tx
        .insert(users)
        .values({
          email: input.email,
          name: input.name ?? input.email.slice(0, input.email.indexOf('@')),
          department: input.department ?? null,
          role: input.role,
          status: 'active',
          createdVia: 'admin',
        })
        .returning(),
      'users insert',
    );
    await writeAudit(tx, {
      actor: { id: ctx.actor.id, label: ctx.actor.email },
      action: AUDIT_ACTIONS.userCreate,
      target: { type: 'user', id: created.id, label: created.email },
      after: { role: created.role, department: created.department, createdVia: 'admin' },
      meta: ctx.meta,
    });
    return created;
  }, ctx.handle);
}

export async function updateUser(ctx: MutationContext, raw: UpdateUserInput): Promise<User> {
  const input = updateUserSchema.parse(raw);
  const updated = await withTransaction(async (tx) => {
    const target = await findUser(tx, input.id);
    const next = { ...target, ...input, department: input.department ?? null };
    await guardAdminLockout(tx, ctx, target, next);
    const diff = diffUser(target, next);
    if (!diff) return target;
    const row = firstRow(
      await tx
        .update(users)
        .set({
          name: next.name,
          department: next.department,
          role: next.role,
          status: next.status,
          updatedAt: new Date(),
        })
        .where(eq(users.id, target.id))
        .returning(),
      'users update',
    );
    await writeAudit(tx, {
      actor: { id: ctx.actor.id, label: ctx.actor.email },
      action: AUDIT_ACTIONS.userUpdate,
      target: { type: 'user', id: target.id, label: target.email },
      ...diff,
      meta: ctx.meta,
    });
    // #31: 역할이 실제로 바뀌었을 때만 대상 본인에게 (활성일 때만, 본인이 바꾼 경우는 제외 — insertForUser)
    if (target.role !== row.role) {
      await insertForUser(tx, row.id, {
        type: 'user.role_changed',
        ...notificationContent.roleChanged(row.role),
        refType: NOTIFICATION_REF.user,
        refId: row.id,
        actorUserId: ctx.actor.id,
      });
    }
    return row;
  }, ctx.handle);
  invalidateSessionUser(updated.id);
  return updated;
}

export async function deactivateUser(
  ctx: MutationContext,
  raw: DeactivateUserInput,
): Promise<User> {
  const { id } = deactivateUserSchema.parse(raw);
  const updated = await withTransaction(async (tx) => {
    const target = await findUser(tx, id);
    if (target.status === 'inactive') return target;
    await guardAdminLockout(tx, ctx, target, { ...target, status: 'inactive' });
    const row = firstRow(
      await tx
        .update(users)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning(),
      'users update',
    );
    await writeAudit(tx, {
      actor: { id: ctx.actor.id, label: ctx.actor.email },
      action: AUDIT_ACTIONS.userDeactivate,
      target: { type: 'user', id, label: target.email },
      before: { status: 'active' },
      after: { status: 'inactive' },
      meta: ctx.meta,
    });
    return row;
  }, ctx.handle);
  invalidateSessionUser(updated.id);
  return updated;
}
