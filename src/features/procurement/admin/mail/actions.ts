'use server';

import { getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import { requireProcurementAccess } from '@/server/procurement/access';
import {
  addMailRecipient,
  AUDIT_PROCUREMENT_MAIL_RECIPIENT_ADD,
  AUDIT_PROCUREMENT_MAIL_RECIPIENT_REMOVE,
  removeMailRecipient,
  type AddMailRecipientInput,
  type MailRecipientView,
  type RemoveMailRecipientInput,
} from '@/server/procurement/mail-recipients';

/**
 * 메일 보고 수신처 Server Actions (수집기 Prami 이전 §3.1, procurement.write = ADMIN). 거부(§4.7.1): FORBIDDEN 봉투 + 감사 denied
 * (action = 시도한 행위 키 procurement.mail_recipient.add|remove) + 변경 없음.
 * 목록 조회는 RSC(MailAdminSection)가 한다. 변경과 감사는 server/procurement/mail-recipients 에서 한 트랜잭션.
 */
async function writeContext(target: string) {
  return {
    access: await requireProcurementAccess('write', target),
    handle: await getDbHandle(),
    meta: await currentRequestMeta(),
  };
}

export async function addMailRecipientAction(
  input: AddMailRecipientInput,
): Promise<ActionResult<MailRecipientView>> {
  const guard = {
    permission: 'procurement.write',
    auditAction: AUDIT_PROCUREMENT_MAIL_RECIPIENT_ADD,
    name: 'addMailRecipient',
  } as const;
  return runAction(guard, async () =>
    addMailRecipient(await writeContext('action:addMailRecipient'), input),
  );
}

export async function removeMailRecipientAction(
  input: RemoveMailRecipientInput,
): Promise<ActionResult<MailRecipientView>> {
  const guard = {
    permission: 'procurement.write',
    auditAction: AUDIT_PROCUREMENT_MAIL_RECIPIENT_REMOVE,
    name: 'removeMailRecipient',
  } as const;
  return runAction(guard, async () =>
    removeMailRecipient(await writeContext('action:removeMailRecipient'), input),
  );
}
