'use server';

import { revalidatePath } from 'next/cache';

import { getDbHandle } from '@/db';
import { env } from '@/env';
import type { ActionResult } from '@/lib/result';
import { AUDIT_ACTIONS } from '@/server/audit/log';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';
import {
  createUser,
  deactivateUser,
  updateUser,
  type MutationContext,
} from '@/server/users/mutations';
import type { CreateUserInput, DeactivateUserInput, UpdateUserInput } from '@/server/users/schemas';

/** 사용자·권한 관리 Server Actions (§4.7, users.manage). 봉투만 반환하고 예외를 흘리지 않는다 */
type UserSummary = { id: string; email: string; role: 'USER' | 'ADMIN'; status: string };

const USERS_PATH = '/admin/users';

async function context(actor: SessionUser): Promise<MutationContext> {
  return {
    handle: await getDbHandle(),
    actor: { id: actor.id, email: actor.email },
    meta: await currentRequestMeta(),
    allowedDomains: env.ALLOWED_EMAIL_DOMAINS,
  };
}

function summary(user: UserSummary): UserSummary {
  return { id: user.id, email: user.email, role: user.role, status: user.status };
}

export async function createUserAction(input: CreateUserInput): Promise<ActionResult<UserSummary>> {
  return runAction(
    { permission: 'users.manage', auditAction: AUDIT_ACTIONS.userCreate, name: 'createUser' },
    async (actor) => {
      const created = await createUser(await context(actor), input);
      revalidatePath(USERS_PATH);
      return summary(created);
    },
  );
}

export async function updateUserAction(input: UpdateUserInput): Promise<ActionResult<UserSummary>> {
  return runAction(
    { permission: 'users.manage', auditAction: AUDIT_ACTIONS.userUpdate, name: 'updateUser' },
    async (actor) => {
      const updated = await updateUser(await context(actor), input);
      revalidatePath(USERS_PATH);
      return summary(updated);
    },
  );
}

export async function deactivateUserAction(
  input: DeactivateUserInput,
): Promise<ActionResult<UserSummary>> {
  return runAction(
    {
      permission: 'users.manage',
      auditAction: AUDIT_ACTIONS.userDeactivate,
      name: 'deactivateUser',
    },
    async (actor) => {
      const updated = await deactivateUser(await context(actor), input);
      revalidatePath(USERS_PATH);
      return summary(updated);
    },
  );
}
