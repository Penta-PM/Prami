'use server';

import { revalidatePath } from 'next/cache';

import { getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';
import {
  AUDIT_NOTICE_CREATE,
  AUDIT_NOTICE_DELETE,
  AUDIT_NOTICE_UPDATE,
  deleteNotice,
  upsertNotice,
  type NoticeContext,
  type NoticeResult,
} from '@/server/notices/mutations';
import type { DeleteNoticeInput, UpsertNoticeInput } from '@/server/notices/schemas';

/**
 * 공지 Server Actions (§4.7 `upsertNotice`/`deleteNotice`, notice.write = ADMIN).
 * USER 호출은 §4.7.1 거부 판정: FORBIDDEN 봉투 + notices 무변경 + 감사 `notice.create|update|delete` denied (AC-51).
 */
async function context(actor: SessionUser): Promise<NoticeContext> {
  return {
    handle: await getDbHandle(),
    actor: { id: actor.id, label: actor.email },
    meta: await currentRequestMeta(),
  };
}

function refresh(id?: string) {
  revalidatePath('/');
  revalidatePath('/notices');
  revalidatePath('/admin/notices');
  if (id) revalidatePath(`/notices/${id}`);
}

export async function upsertNoticeAction(
  input: UpsertNoticeInput,
): Promise<ActionResult<NoticeResult>> {
  const guard = {
    permission: 'notice.write',
    auditAction: input.id ? AUDIT_NOTICE_UPDATE : AUDIT_NOTICE_CREATE,
    name: 'upsertNotice',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await upsertNotice(await context(actor), input);
    refresh(result.id);
    return result;
  });
}

export async function deleteNoticeAction(
  input: DeleteNoticeInput,
): Promise<ActionResult<NoticeResult>> {
  const guard = {
    permission: 'notice.write',
    auditAction: AUDIT_NOTICE_DELETE,
    name: 'deleteNotice',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await deleteNotice(await context(actor), input);
    refresh(result.id);
    return result;
  });
}
