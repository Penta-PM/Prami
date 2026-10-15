'use server';

import { z } from 'zod';

import { getDb } from '@/db';
import type { ActionResult } from '@/lib/result';
import { runAction } from '@/server/auth/rbac';
import { markAllRead, markRead } from '@/server/notifications/mutations';
import { countUnread } from '@/server/notifications/queries';

/**
 * 알림 읽음 처리 Server Actions (#31 §4, notification.self). 항상 세션 사용자 본인 알림만 바꾼다(IDOR 방지) —
 * 남의 id·없는 id 는 0행으로 조용히 성공한다. 감사 로그는 남기지 않는다. 봉투만 반환한다.
 */
const markReadSchema = z.object({ id: z.uuid() });

export async function markNotificationReadAction(input: {
  id: string;
}): Promise<ActionResult<{ unreadCount: number }>> {
  return runAction(
    {
      permission: 'notification.self',
      auditAction: 'notification.read',
      name: 'markNotificationRead',
    },
    async (user) => {
      const { id } = markReadSchema.parse(input);
      const db = await getDb();
      await markRead(db, id, user.id);
      return { unreadCount: await countUnread(db, user.id) };
    },
  );
}

export async function markAllNotificationsReadAction(): Promise<
  ActionResult<{ unreadCount: number }>
> {
  return runAction(
    {
      permission: 'notification.self',
      auditAction: 'notification.read_all',
      name: 'markAllNotificationsRead',
    },
    async (user) => {
      const db = await getDb();
      await markAllRead(db, user.id);
      return { unreadCount: await countUnread(db, user.id) };
    },
  );
}
