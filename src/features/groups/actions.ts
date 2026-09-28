'use server';

import { revalidatePath } from 'next/cache';

import { getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';
import {
  AUDIT_GROUP_CREATE,
  AUDIT_GROUP_DELETE,
  AUDIT_GROUP_UPDATE,
  deleteSolutionGroup,
  upsertSolutionGroup,
  type GroupsContext,
  type SolutionGroupResult,
} from '@/server/groups/mutations';
import type { DeleteSolutionGroupInput, UpsertSolutionGroupInput } from '@/server/groups/schemas';

/** 솔루션 그룹 Server Actions (§4.7 `upsertSolutionGroup`/`deleteSolutionGroup`, groups.write = ADMIN) */
const GROUPS_PATH = '/admin/groups';

async function context(actor: SessionUser): Promise<GroupsContext> {
  return {
    handle: await getDbHandle(),
    actor: { id: actor.id, label: actor.email },
    meta: await currentRequestMeta(),
  };
}

export async function upsertSolutionGroupAction(
  input: UpsertSolutionGroupInput,
): Promise<ActionResult<SolutionGroupResult>> {
  const guard = {
    permission: 'groups.write',
    auditAction: input.id ? AUDIT_GROUP_UPDATE : AUDIT_GROUP_CREATE,
    name: 'upsertSolutionGroup',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await upsertSolutionGroup(await context(actor), input);
    revalidatePath(GROUPS_PATH);
    return result;
  });
}

export async function deleteSolutionGroupAction(
  input: DeleteSolutionGroupInput,
): Promise<ActionResult<SolutionGroupResult>> {
  const guard = {
    permission: 'groups.write',
    auditAction: AUDIT_GROUP_DELETE,
    name: 'deleteSolutionGroup',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await deleteSolutionGroup(await context(actor), input);
    revalidatePath(GROUPS_PATH);
    return result;
  });
}
