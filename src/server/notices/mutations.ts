import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { notices, type Notice } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { AppError } from '@/lib/result';
import { writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';
import { insertForActiveUsers } from '@/server/notifications/audience';
import { deleteForNotice } from '@/server/notifications/mutations';
import { NOTIFICATION_REF, notificationContent } from '@/server/notifications/types';

import {
  deleteNoticeSchema,
  upsertNoticeSchema,
  type DeleteNoticeInput,
  type UpsertNoticeInput,
} from './schemas';

/**
 * 공지 등록·수정·삭제 (§4.5.4, §4.7 `upsertNotice`/`deleteNotice`, ADMIN). 권한 검사는 호출자(runAction)가 하고
 * 여기서는 검증·변경·감사(변경 전/후 스냅샷)를 한 트랜잭션으로 처리한다. 삭제는 soft delete.
 */
export type NoticeContext = { handle: DbHandle; actor: AuditActor; meta: RequestMeta };

export const AUDIT_NOTICE_CREATE = 'notice.create';
export const AUDIT_NOTICE_UPDATE = 'notice.update';
export const AUDIT_NOTICE_DELETE = 'notice.delete';

export type NoticeResult = { id: string; title: string };

const SNAPSHOT_KEYS = ['title', 'authorName', 'isImportant', 'publishedAt'] as const;

export function noticeSnapshot(row: Notice): Record<string, unknown> {
  return {
    ...Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, row[key]])),
    bodyLength: row.body.length,
  };
}

async function findActive(tx: Tx, id: string): Promise<Notice> {
  const [row] = await tx
    .select()
    .from(notices)
    .where(and(eq(notices.id, id), isNull(notices.deletedAt)))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', '공지를 찾을 수 없습니다');
  return row;
}

function target(row: Notice) {
  return { type: 'notice', id: row.id, label: row.title };
}

function valuesOf(parsed: ReturnType<typeof upsertNoticeSchema.parse>) {
  const { title, authorName, body, isImportant } = parsed;
  return { title, authorName, body, isImportant };
}

export async function createNotice(ctx: NoticeContext, raw: UpsertNoticeInput) {
  const parsed = upsertNoticeSchema.parse(raw);
  const publishedAt = parsed.publishedAt;
  return withTransaction(async (tx) => {
    const created = firstRow(
      await tx
        .insert(notices)
        .values({
          ...valuesOf(parsed),
          ...(publishedAt ? { publishedAt } : {}),
          authorUserId: ctx.actor.id,
        })
        .returning(),
      'notices insert',
    );
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_NOTICE_CREATE,
      target: target(created),
      after: noticeSnapshot(created),
      meta: ctx.meta,
    });
    // #31: 신규 게시만 알린다(수정은 알리지 않음). 같은 트랜잭션 — 실패하면 공지도 롤백
    await insertForActiveUsers(tx, {
      type: 'notice.created',
      ...notificationContent.noticeCreated(created.title),
      refType: NOTIFICATION_REF.notice,
      refId: created.id,
      actorUserId: ctx.actor.id,
    });
    return { id: created.id, title: created.title };
  }, ctx.handle);
}

export async function updateNotice(ctx: NoticeContext, raw: UpsertNoticeInput) {
  const parsed = upsertNoticeSchema.parse(raw);
  const { id, publishedAt } = parsed;
  if (!id) throw new AppError('VALIDATION', '수정할 공지 id 가 없습니다');
  return withTransaction(async (tx) => {
    const before = await findActive(tx, id);
    const updated = firstRow(
      await tx
        .update(notices)
        .set({
          ...valuesOf(parsed),
          publishedAt: publishedAt ?? before.publishedAt,
          updatedAt: new Date(),
        })
        .where(eq(notices.id, id))
        .returning(),
      'notices update',
    );
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_NOTICE_UPDATE,
      target: target(updated),
      before: noticeSnapshot(before),
      after: noticeSnapshot(updated),
      meta: ctx.meta,
    });
    return { id: updated.id, title: updated.title };
  }, ctx.handle);
}

/** id 가 있으면 수정, 없으면 등록 */
export function upsertNotice(ctx: NoticeContext, raw: UpsertNoticeInput): Promise<NoticeResult> {
  return raw.id ? updateNotice(ctx, raw) : createNotice(ctx, raw);
}

export async function deleteNotice(ctx: NoticeContext, raw: DeleteNoticeInput) {
  const { id } = deleteNoticeSchema.parse(raw);
  return withTransaction(async (tx) => {
    const before = await findActive(tx, id);
    await tx
      .update(notices)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(notices.id, id));
    // #31: 삭제된 공지를 가리키는 알림을 같은 트랜잭션에서 지운다 (조회 필터와 이중 방어)
    await deleteForNotice(tx, id);
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_NOTICE_DELETE,
      target: target(before),
      before: noticeSnapshot(before),
      after: { deletedAt: 'now' },
      meta: ctx.meta,
    });
    return { id, title: before.title };
  }, ctx.handle);
}
