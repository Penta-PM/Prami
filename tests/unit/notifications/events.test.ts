// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { notices, notifications, policyApplyRuns, type User } from '@/db/schema';
import { applyPolicy } from '@/server/imports/apply-policy';
import {
  createNotice,
  deleteNotice,
  updateNotice,
  type NoticeContext,
} from '@/server/notices/mutations';
import { insertForActiveUsers, insertForUser } from '@/server/notifications/audience';
import { markAllRead, markRead } from '@/server/notifications/mutations';
import { countUnread, getNotifications, listNotifications } from '@/server/notifications/queries';
import { updateUser, type MutationContext } from '@/server/users/mutations';
import { withTransaction } from '@/db/tx';

import { TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * #31 알림 이벤트·조회·읽음 (PGlite, §6 서버 수용 기준):
 * 공지 게시 fan-out(행위자·비활성 제외)·수정 무알림·삭제 정리·소급 없음, 가격정책 적용 성공/실패,
 * 역할 변경(대상 1명·역할 외 필드 무알림), 원자성, IDOR, 30일 창, 안 읽은 개수, 모두 읽음.
 */
let handle: DbHandle;
let admin: User;
let admin2: User;
let userB: User;
let userC: User;
let inactive: User;
let noticeCtx: NoticeContext;
let userCtx: MutationContext;

const NOTICE = {
  title: '하반기 가격정책 안내',
  authorName: '가격정책팀',
  body: '본문',
  isImportant: true,
};

const rowsFor = (userId: string) =>
  handle.db.select().from(notifications).where(eq(notifications.userId, userId));
const countAll = () => handle.db.$count(notifications);

beforeAll(async () => {
  handle = await createTestDb();
  admin = await insertUser(handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' });
  admin2 = await insertUser(handle, { email: 'admin2@pentasecurity.com', role: 'ADMIN' });
  userB = await insertUser(handle, { email: 'b@pentasecurity.com', role: 'USER' });
  userC = await insertUser(handle, { email: 'c@pentasecurity.com', role: 'USER' });
  inactive = await insertUser(handle, {
    email: 'gone@pentasecurity.com',
    role: 'USER',
    status: 'inactive',
  });
  noticeCtx = { handle, actor: { id: admin.id, label: admin.email }, meta: TEST_META };
  userCtx = {
    handle,
    actor: { id: admin.id, email: admin.email },
    meta: TEST_META,
    allowedDomains: ['pentasecurity.com'],
  };
});

afterAll(async () => {
  await handle.close();
});

async function reset() {
  await handle.db.delete(notifications);
}

describe('notice.created', () => {
  it('소급 없음: 기능 이전(훅을 거치지 않은) 공지로는 알림이 0건', async () => {
    await handle.db
      .insert(notices)
      .values({ ...NOTICE, title: '예전 공지', authorUserId: admin.id });
    expect(await countAll()).toBe(0);
    expect((await getNotifications(handle.db, userB.id)).unreadCount).toBe(0);
  });

  it('게시하면 행위자를 뺀 활성 사용자 전원에게 1행씩, 비활성 사용자는 0', async () => {
    await reset();
    const created = await createNotice(noticeCtx, NOTICE);
    const rows = await handle.db.select().from(notifications);
    expect(rows.map((row) => row.userId).sort()).toEqual([admin2.id, userB.id, userC.id].sort());
    expect(await rowsFor(admin.id)).toHaveLength(0);
    expect(await rowsFor(inactive.id)).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      type: 'notice.created',
      title: `새 공지: ${NOTICE.title}`,
      body: null,
      refType: 'notice',
      refId: created.id,
      actorUserId: admin.id,
      readAt: null,
    });
    const view = await getNotifications(handle.db, userB.id);
    expect(view.unreadCount).toBe(1);
    expect(view.items).toEqual([
      expect.objectContaining({
        type: 'notice.created',
        href: `/notices/${created.id}`,
        important: true,
        read: false,
      }),
    ]);
    expect(view.items[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('공지 제목 200자에서도 알림 제목은 200자 이하로 잘린다(check 제약 위반 없음)', async () => {
    await reset();
    await createNotice(noticeCtx, { ...NOTICE, title: '가'.repeat(200), isImportant: false });
    const [row] = await rowsFor(userB.id);
    expect(Array.from(row!.title).length).toBeLessThanOrEqual(200);
    expect(row!.title.startsWith('새 공지: ')).toBe(true);
    expect((await listNotifications(handle.db, userB.id))[0]!.important).toBe(false);
  });

  it('수정해도 새 알림이 생기지 않는다', async () => {
    await reset();
    const created = await createNotice(noticeCtx, NOTICE);
    const before = await countAll();
    await updateNotice(noticeCtx, {
      ...NOTICE,
      id: created.id,
      title: '수정한 제목',
      isImportant: false,
    });
    expect(await countAll()).toBe(before);
  });

  it('삭제하면 같은 트랜잭션에서 그 공지의 알림 행이 지워지고 목록·배지에서 빠진다', async () => {
    await reset();
    const keep = await createNotice(noticeCtx, { ...NOTICE, title: '유지' });
    const gone = await createNotice(noticeCtx, { ...NOTICE, title: '삭제 대상' });
    expect((await getNotifications(handle.db, userB.id)).unreadCount).toBe(2);
    await deleteNotice(noticeCtx, { id: gone.id });
    const left = await handle.db.select().from(notifications);
    expect(left.every((row) => row.refId === keep.id)).toBe(true);
    const view = await getNotifications(handle.db, userB.id);
    expect(view.unreadCount).toBe(1);
    expect(view.items.map((item) => item.href)).toEqual([`/notices/${keep.id}`]);
  });

  it('조회 이중 방어: 행이 남아 있어도 soft delete 된 공지를 가리키면 빠진다', async () => {
    await reset();
    const created = await createNotice(noticeCtx, NOTICE);
    await handle.db
      .update(notices)
      .set({ deletedAt: new Date() })
      .where(eq(notices.id, created.id));
    expect(await rowsFor(userB.id)).toHaveLength(1);
    expect(await getNotifications(handle.db, userB.id)).toEqual({ unreadCount: 0, items: [] });
  });
});

describe('원자성 (같은 트랜잭션)', () => {
  it('알림 insert 가 실패하면 공지도 롤백된다 → 공지 0 · 알림 0', async () => {
    await reset();
    const noticesBefore = await handle.db.$count(notices);
    await handle.db.execute(
      sql`alter table notifications add constraint test_block_ck check (false) not valid`,
    );
    try {
      await expect(createNotice(noticeCtx, { ...NOTICE, title: '롤백 대상' })).rejects.toThrow();
    } finally {
      await handle.db.execute(sql`alter table notifications drop constraint test_block_ck`);
    }
    expect(await handle.db.$count(notices)).toBe(noticesBefore);
    expect(await countAll()).toBe(0);
  });

  it('공지 insert 가 실패하면 알림이 0건', async () => {
    await reset();
    const noticesBefore = await handle.db.$count(notices);
    await handle.db.execute(
      sql`alter table notices add constraint test_block_ck check (false) not valid`,
    );
    try {
      await expect(createNotice(noticeCtx, NOTICE)).rejects.toThrow();
    } finally {
      await handle.db.execute(sql`alter table notices drop constraint test_block_ck`);
    }
    expect(await handle.db.$count(notices)).toBe(noticesBefore);
    expect(await countAll()).toBe(0);
  });
});

describe('user.role_changed', () => {
  it('역할을 바꾸면 대상 1명에게만, /settings, 본문 없음', async () => {
    await reset();
    await updateUser(userCtx, { id: userB.id, name: userB.name, role: 'ADMIN', status: 'active' });
    const rows = await handle.db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: userB.id,
      type: 'user.role_changed',
      title: '역할이 관리자로 변경되었습니다',
      body: null,
      actorUserId: admin.id,
    });
    const [item] = await listNotifications(handle.db, userB.id);
    expect(item).toMatchObject({ href: '/settings', important: false });
    await updateUser(userCtx, { id: userB.id, name: userB.name, role: 'USER', status: 'active' });
    expect((await listNotifications(handle.db, userB.id))[0]!.title).toBe(
      '역할이 사용자로 변경되었습니다',
    );
  });

  it('역할 외 필드만 바꾸면 알림이 없다', async () => {
    await reset();
    await updateUser(userCtx, {
      id: userC.id,
      name: '새 이름',
      department: '영업',
      role: 'USER',
      status: 'active',
    });
    expect(await countAll()).toBe(0);
  });

  it('역할과 함께 비활성화되면(비활성 대상) 알림을 만들지 않는다', async () => {
    await reset();
    const temp = await insertUser(handle, { email: 'temp@pentasecurity.com', role: 'USER' });
    await updateUser(userCtx, { id: temp.id, name: temp.name, role: 'ADMIN', status: 'inactive' });
    expect(await countAll()).toBe(0);
  });

  it('insertForUser: 행위자 본인·비활성 사용자에게는 0행', async () => {
    await reset();
    const draft = {
      type: 'user.role_changed' as const,
      title: 't',
      body: null,
      refType: 'user',
      refId: admin.id,
      actorUserId: admin.id,
    };
    const made = await withTransaction(async (tx) => {
      const self = await insertForUser(tx, admin.id, draft);
      const off = await insertForUser(tx, inactive.id, { ...draft, actorUserId: null });
      return { self, off };
    }, handle);
    expect(made).toEqual({ self: 0, off: 0 });
  });
});

describe('policy.applied', () => {
  let salesId: string;

  beforeAll(async () => {
    salesId = (await uploadFixture(handle, 'sales', 'sales-200.xlsx')).batchId;
  });

  const input = () => ({
    salesBatchId: salesId,
    itemBatchId: null,
    salesReused: false,
    itemReused: false,
  });

  it('적용 실패(마지막 검증 단계 실패 주입)면 알림이 생기지 않는다', async () => {
    await reset();
    await expect(
      applyPolicy(
        {
          handle,
          actor: { id: admin.id, label: admin.email },
          meta: TEST_META,
          failAfter: 'verify',
        },
        input(),
      ),
    ).rejects.toBeTruthy();
    const [run] = await handle.db.select().from(policyApplyRuns);
    expect(run?.status).toBe('failed');
    expect(await countAll()).toBe(0);
  });

  it('성공하면 실행자를 뺀 활성 사용자 전원, 본문은 반영 건수만(금액 없음), /pricing', async () => {
    await reset();
    const { runId, stats } = await applyPolicy(
      { handle, actor: { id: admin.id, label: admin.email }, meta: TEST_META },
      input(),
    );
    const rows = await handle.db.select().from(notifications);
    const activeOthers = [admin2.id, userB.id, userC.id];
    expect(rows.map((row) => row.userId).sort()).toEqual(
      expect.arrayContaining(activeOthers.sort()),
    );
    expect(rows.some((row) => row.userId === admin.id || row.userId === inactive.id)).toBe(false);
    for (const row of rows) {
      expect(row).toMatchObject({
        type: 'policy.applied',
        title: '가격정책이 갱신되었습니다',
        body: `반영 ${stats.inserted}건`,
        refType: 'policy_apply_run',
        refId: runId,
      });
      // 숫자는 반영 건수 하나뿐 — 금액·통화 표기 없음
      expect(row.body!.match(/\d+/g)).toEqual([String(stats.inserted)]);
      expect(`${row.title} ${row.body}`).not.toMatch(/원|₩|\$|KRW|USD|단가|원가/);
    }
    const [item] = await listNotifications(handle.db, userB.id);
    expect(item).toMatchObject({ type: 'policy.applied', href: '/pricing', important: false });
  });

  it('사용자 행위자가 없는 스크립트 적용(actor.id=null)은 알리지 않는다', async () => {
    await reset();
    await applyPolicy(
      { handle, actor: { id: null, label: 'script:vitest' }, meta: TEST_META },
      { ...input(), salesReused: true },
    );
    expect(await countAll()).toBe(0);
  });
});

describe('조회·읽음 (IDOR·30일 창)', () => {
  const NOW = new Date('2026-10-12T00:00:00Z');
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

  async function seed(userId: string, title: string, createdAt: Date) {
    const [row] = await handle.db
      .insert(notifications)
      .values({ userId, type: 'policy.applied', title, body: '반영 1건', createdAt })
      .returning();
    return row!;
  }

  it('30일이 지난 알림은 목록·배지에서 빠지고, 최신순(created_at desc, id desc)', async () => {
    await reset();
    await seed(userB.id, 'old', daysAgo(31));
    await seed(userB.id, 'edge', daysAgo(29.9));
    await seed(userB.id, 'new', daysAgo(1));
    const view = await getNotifications(handle.db, userB.id, { now: NOW });
    expect(view.items.map((item) => item.title)).toEqual(['new', 'edge']);
    expect(view.unreadCount).toBe(2);
    expect(await countUnread(handle.db, userB.id, new Date(NOW.getTime() + 2 * 86_400_000))).toBe(
      1,
    );
  });

  it('limit 은 1..50 으로 자른다', async () => {
    await reset();
    for (let i = 0; i < 3; i += 1) await seed(userB.id, `n${i}`, daysAgo(i));
    expect(await listNotifications(handle.db, userB.id, { now: NOW, limit: 2 })).toHaveLength(2);
    expect(await listNotifications(handle.db, userB.id, { now: NOW, limit: 0 })).toHaveLength(1);
  });

  it('IDOR: 남의 알림 id 로 읽음 처리해도 바뀌지 않고, 조회는 본인 것만', async () => {
    await reset();
    const mine = await seed(userB.id, 'B 의 알림', daysAgo(0));
    const theirs = await seed(userC.id, 'C 의 알림', daysAgo(0));
    expect(await markRead(handle.db, theirs.id, userB.id)).toBe(0);
    const [still] = await handle.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, theirs.id));
    expect(still!.readAt).toBeNull();
    expect((await listNotifications(handle.db, userB.id, { now: NOW })).map((i) => i.id)).toEqual([
      mine.id,
    ]);
    expect(await markRead(handle.db, mine.id, userB.id)).toBe(1);
    expect(await markRead(handle.db, mine.id, userB.id)).toBe(0);
    const [item] = await listNotifications(handle.db, userB.id, { now: NOW });
    expect(item!.read).toBe(true);
    expect(await countUnread(handle.db, userB.id, NOW)).toBe(0);
    expect(await countUnread(handle.db, userC.id, NOW)).toBe(1);
  });

  it('모두 읽음은 본인 것만, 다시 조회해도 0 유지', async () => {
    await reset();
    await seed(userB.id, 'a', daysAgo(0));
    await seed(userB.id, 'b', daysAgo(0));
    await seed(userC.id, 'c', daysAgo(0));
    expect(await markAllRead(handle.db, userB.id)).toBe(2);
    expect(await countUnread(handle.db, userB.id, NOW)).toBe(0);
    expect(await countUnread(handle.db, userC.id, NOW)).toBe(1);
  });

  it('href 를 만들 수 없는 행(공지 ref 가 UUID 아님·모르는 type)은 목록에서 뺀다', async () => {
    await reset();
    await handle.db.insert(notifications).values([
      { userId: userB.id, type: 'notice.created', title: 'x', refType: 'notice', refId: '../x' },
      { userId: userB.id, type: 'unknown.type', title: 'y' },
    ]);
    expect(await getNotifications(handle.db, userB.id)).toEqual({ unreadCount: 0, items: [] });
  });

  it('insertForActiveUsers 는 INSERT … SELECT 한 문장으로 만든 행 수를 돌려준다', async () => {
    await reset();
    const made = await withTransaction(
      (tx) =>
        insertForActiveUsers(tx, {
          type: 'policy.applied',
          title: 't',
          body: null,
          refType: null,
          refId: null,
          actorUserId: null,
        }),
      handle,
    );
    expect(made).toBe(await countAll());
    expect(await rowsFor(inactive.id)).toHaveLength(0);
  });
});
