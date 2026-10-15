import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import type { Db } from '@/db';
import { notifications } from '@/db/schema';
import type { Tx } from '@/db/tx';

import { NOTIFICATION_REF } from './types';

/**
 * 읽음 처리·공지 삭제 정리 (#31 §4). 읽음 처리는 항상 `id AND user_id = 세션 사용자` (IDOR 방지) —
 * 남의 알림이거나 없는 id 면 0행으로 조용히 끝난다. 감사 로그는 남기지 않는다.
 */
type Executor = Db | Tx;

export async function markRead(db: Executor, id: string, userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)),
    )
    .returning({ id: notifications.id });
  return rows.length;
}

export async function markAllRead(db: Executor, userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}

/** 공지 soft delete 와 같은 트랜잭션에서 그 공지를 가리키는 알림 행을 지운다 */
export async function deleteForNotice(tx: Tx, noticeId: string): Promise<number> {
  const rows = await tx
    .delete(notifications)
    .where(
      and(eq(notifications.refType, NOTIFICATION_REF.notice), eq(notifications.refId, noticeId)),
    )
    .returning({ id: notifications.id });
  return rows.length;
}
