'use server';

import { revalidatePath } from 'next/cache';

import { getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';
import {
  applyPartImport,
  AUDIT_PART_IMPORT_APPLY,
  type PartApplyStats,
} from '@/server/parts/apply-parts';
import {
  AUDIT_PART_DELETE,
  AUDIT_PART_SAVE,
  deletePartMapping,
  savePartMapping,
  type PartsContext,
  type SavePartMappingResult,
} from '@/server/parts/mutations';
import type {
  ApplyPartImportInput,
  DeletePartMappingInput,
  SavePartMappingInput,
} from '@/server/parts/schemas';

/**
 * 파츠 관리 Server Actions (§4.7 `savePartMapping`/`deletePartMapping`, parts.write = ADMIN).
 * USER 호출은 §4.7.1 거부 판정(FORBIDDEN 봉투 + part_mappings 무변경 + 감사 denied).
 */
const PARTS_PATH = '/admin/parts';

async function context(actor: SessionUser): Promise<PartsContext> {
  return {
    handle: await getDbHandle(),
    actor: { id: actor.id, label: actor.email },
    meta: await currentRequestMeta(),
  };
}

export async function savePartMappingAction(
  input: SavePartMappingInput,
): Promise<ActionResult<SavePartMappingResult>> {
  const guard = {
    permission: 'parts.write',
    auditAction: AUDIT_PART_SAVE,
    name: 'savePartMapping',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await savePartMapping(await context(actor), input);
    revalidatePath(PARTS_PATH);
    return result;
  });
}

export async function deletePartMappingAction(
  input: DeletePartMappingInput,
): Promise<ActionResult<{ modelItemCode: string; removed: number }>> {
  const guard = {
    permission: 'parts.write',
    auditAction: AUDIT_PART_DELETE,
    name: 'deletePartMapping',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await deletePartMapping(await context(actor), input);
    revalidatePath(PARTS_PATH);
    return result;
  });
}

export async function applyPartImportAction(
  input: ApplyPartImportInput,
): Promise<ActionResult<PartApplyStats>> {
  const guard = {
    permission: 'parts.write',
    auditAction: AUDIT_PART_IMPORT_APPLY,
    name: 'applyPartImport',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await applyPartImport(await context(actor), input);
    revalidatePath(PARTS_PATH);
    return result;
  });
}
