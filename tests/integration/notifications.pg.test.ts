import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { notifications, users, type User } from '@/db/schema';
import { createNotice, deleteNotice, type NoticeContext } from '@/server/notices/mutations';
import { markRead } from '@/server/notifications/mutations';
import { getNotifications } from '@/server/notifications/queries';

/**
 * #31 — 실제 PostgreSQL 16 (DB_DRIVER=pg). node-postgres 에서 fan-out `INSERT … SELECT`(파라미터 타입 추론)·
 * 공지 left join 조회·삭제 정리가 PGlite 와 같게 동작하는지 확인한다. 공유 DB 라 만든 공지(삭제)·사용자(비활성화)만 정리한다.
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);

describe.skipIf(!enabled)('PostgreSQL 알림 fan-out (#31)', () => {
  let handle: DbHandle;
  let actor: User;
  let receiver: User;
  let off: User;

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
    const tag = Date.now();
    const insert = (email: string, status: 'active' | 'inactive') =>
      handle.db
        .insert(users)
        .values({ email, name: email.split('@')[0]!, createdVia: 'admin', status })
        .returning()
        .then((rows) => rows[0]!);
    actor = await insert(`notif-actor-${tag}@pentasecurity.com`, 'active');
    receiver = await insert(`notif-recv-${tag}@pentasecurity.com`, 'active');
    off = await insert(`notif-off-${tag}@pentasecurity.com`, 'inactive');
  });

  afterAll(async () => {
    if (handle) {
      // 감사 로그가 사용자를 참조해(append-only) 지울 수 없다 — 비활성화해 다른 테스트의 fan-out 대상에서 뺀다
      const ids = [actor.id, receiver.id, off.id];
      await handle.db.delete(notifications).where(inArray(notifications.userId, ids));
      await handle.db.update(users).set({ status: 'inactive' }).where(inArray(users.id, ids));
      await handle.close();
    }
  });

  it('공지 게시 → 행위자·비활성 제외 fan-out, 조회·읽음, 삭제 시 정리', async () => {
    const ctx: NoticeContext = {
      handle,
      actor: { id: actor.id, label: actor.email },
      meta: { ip: null, userAgent: 'vitest' },
    };
    const notice = await createNotice(ctx, {
      title: 'pg 알림 확인',
      authorName: 'vitest',
      body: '본문',
      isImportant: true,
    });
    try {
      const rows = await handle.db
        .select()
        .from(notifications)
        .where(eq(notifications.refId, notice.id));
      const recipients = rows.map((row) => row.userId);
      expect(recipients).toContain(receiver.id);
      expect(recipients).not.toContain(actor.id);
      expect(recipients).not.toContain(off.id);
      expect(rows.every((row) => row.body === null && row.actorUserId === actor.id)).toBe(true);

      const view = await getNotifications(handle.db, receiver.id);
      expect(view.unreadCount).toBe(1);
      expect(view.items[0]).toMatchObject({
        href: `/notices/${notice.id}`,
        important: true,
        read: false,
      });
      expect(await markRead(handle.db, view.items[0]!.id, actor.id)).toBe(0);
      expect(await markRead(handle.db, view.items[0]!.id, receiver.id)).toBe(1);
      expect((await getNotifications(handle.db, receiver.id)).unreadCount).toBe(0);
    } finally {
      await deleteNotice(ctx, { id: notice.id });
    }
    expect(await handle.db.$count(notifications, eq(notifications.refId, notice.id))).toBe(0);
  });
});
