import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { solutionGroupItems, solutionGroups, type SolutionGroup } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { AppError } from '@/lib/result';
import { writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';
import { ensureItemStubs } from '@/server/parts/mutations';

import {
  deleteSolutionGroupSchema,
  upsertSolutionGroupSchema,
  type DeleteSolutionGroupInput,
  type UpsertSolutionGroupInput,
} from './schemas';

/**
 * 솔루션 그룹 CRUD (§4.3.7, §4.5.6). 항목은 전체 교체, 삭제는 soft delete, 감사
 * `solution_group.create|update|delete`(그룹명·제품군·항목 품번 스냅샷).
 */
export type GroupsContext = { handle: DbHandle; actor: AuditActor; meta: RequestMeta };

export const AUDIT_GROUP_CREATE = 'solution_group.create';
export const AUDIT_GROUP_UPDATE = 'solution_group.update';
export const AUDIT_GROUP_DELETE = 'solution_group.delete';

export type SolutionGroupResult = { id: string; name: string };

type ParsedInput = ReturnType<typeof upsertSolutionGroupSchema.parse>;

async function snapshot(tx: Tx, group: SolutionGroup): Promise<Record<string, unknown>> {
  const rows = await tx
    .select({ itemCode: solutionGroupItems.itemCode, defaultQty: solutionGroupItems.defaultQty })
    .from(solutionGroupItems)
    .where(eq(solutionGroupItems.groupId, group.id))
    .orderBy(solutionGroupItems.sortOrder);
  return {
    name: group.name,
    productFamily: group.productFamily,
    items: rows.map((row) => `${row.itemCode}×${row.defaultQty}`),
  };
}

async function findActive(tx: Tx, id: string): Promise<SolutionGroup> {
  const [row] = await tx
    .select()
    .from(solutionGroups)
    .where(and(eq(solutionGroups.id, id), isNull(solutionGroups.deletedAt)));
  if (!row) throw new AppError('NOT_FOUND', '솔루션 그룹을 찾을 수 없습니다');
  return row;
}

async function replaceItems(tx: Tx, groupId: string, input: ParsedInput) {
  const unknown = await ensureItemStubs(
    tx,
    input.items.map((item) => item.itemCode),
  );
  if (unknown.length > 0) {
    throw new AppError('VALIDATION', `존재하지 않는 품번입니다: ${unknown.join(', ')}`, {
      items: unknown.map((code) => `${code}: 품목 마스터·판매단가에 없는 품번입니다`),
    });
  }
  await tx.delete(solutionGroupItems).where(eq(solutionGroupItems.groupId, groupId));
  await tx.insert(solutionGroupItems).values(
    input.items.map((item, index) => ({
      groupId,
      itemCode: item.itemCode,
      defaultQty: item.defaultQty,
      sortOrder: index,
    })),
  );
}

async function createGroup(ctx: GroupsContext, input: ParsedInput): Promise<SolutionGroupResult> {
  return withTransaction(async (tx) => {
    const created = firstRow(
      await tx
        .insert(solutionGroups)
        .values({ productFamily: input.productFamily, name: input.name, createdBy: ctx.actor.id })
        .returning(),
      'solution_groups insert',
    );
    await replaceItems(tx, created.id, input);
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_GROUP_CREATE,
      target: { type: 'solution_group', id: created.id, label: created.name },
      after: await snapshot(tx, created),
      meta: ctx.meta,
    });
    return { id: created.id, name: created.name };
  }, ctx.handle);
}

async function updateGroup(
  ctx: GroupsContext,
  id: string,
  input: ParsedInput,
): Promise<SolutionGroupResult> {
  return withTransaction(async (tx) => {
    const before = await findActive(tx, id);
    const beforeSnapshot = await snapshot(tx, before);
    const updated = firstRow(
      await tx
        .update(solutionGroups)
        .set({ productFamily: input.productFamily, name: input.name, updatedAt: new Date() })
        .where(eq(solutionGroups.id, id))
        .returning(),
      'solution_groups update',
    );
    await replaceItems(tx, id, input);
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_GROUP_UPDATE,
      target: { type: 'solution_group', id, label: updated.name },
      before: beforeSnapshot,
      after: await snapshot(tx, updated),
      meta: ctx.meta,
    });
    return { id, name: updated.name };
  }, ctx.handle);
}

/** id 가 있으면 수정, 없으면 생성 (§4.7 `upsertSolutionGroup`) */
export async function upsertSolutionGroup(
  ctx: GroupsContext,
  raw: UpsertSolutionGroupInput,
): Promise<SolutionGroupResult> {
  const input = upsertSolutionGroupSchema.parse(raw);
  return input.id ? updateGroup(ctx, input.id, input) : createGroup(ctx, input);
}

export async function deleteSolutionGroup(
  ctx: GroupsContext,
  raw: DeleteSolutionGroupInput,
): Promise<SolutionGroupResult> {
  const { id } = deleteSolutionGroupSchema.parse(raw);
  return withTransaction(async (tx) => {
    const before = await findActive(tx, id);
    await tx
      .update(solutionGroups)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(solutionGroups.id, id));
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_GROUP_DELETE,
      target: { type: 'solution_group', id, label: before.name },
      before: await snapshot(tx, before),
      after: { deletedAt: 'now' },
      meta: ctx.meta,
    });
    return { id, name: before.name };
  }, ctx.handle);
}
