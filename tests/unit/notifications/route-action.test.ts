// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, notifications } from '@/db/schema';
import type { NotificationsResponse } from '@/features/notifications/types';

import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * GET /api/notifications · markNotificationReadAction · markAllNotificationsReadAction (#31 §4):
 * 비로그인·비활성 401, 본인 것만, Cache-Control no-store, limit 1..50, IDOR 0행 조용히 성공, 잘못된 id VALIDATION,
 * 조회·읽음은 감사 로그를 남기지 않는다.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
  currentRequestId: async () => null,
}));

const { GET } = await import('@/app/api/notifications/route');
const { markNotificationReadAction, markAllNotificationsReadAction } =
  await import('@/features/notifications/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let userB: string;
let userC: string;
let inactiveId: string;
const ids: { b: string[]; c: string } = { b: [], c: '' };

const get = (query = '') => GET(new Request(`http://localhost/api/notifications${query}`));

beforeAll(async () => {
  state.handle = await createTestDb();
  userB = (await insertUser(state.handle, { email: 'b@pentasecurity.com', role: 'USER' })).id;
  userC = (await insertUser(state.handle, { email: 'c@pentasecurity.com', role: 'ADMIN' })).id;
  inactiveId = (
    await insertUser(state.handle, {
      email: 'off@pentasecurity.com',
      role: 'USER',
      status: 'inactive',
    })
  ).id;
  const now = Date.now();
  for (let i = 0; i < 25; i += 1) {
    const [row] = await state.handle.db
      .insert(notifications)
      .values({
        userId: userB,
        type: 'policy.applied',
        title: `B-${i}`,
        body: '반영 1건',
        createdAt: new Date(now - i * 60_000),
      })
      .returning();
    ids.b.push(row!.id);
  }
  const [c] = await state.handle.db
    .insert(notifications)
    .values({ userId: userC, type: 'user.role_changed', title: 'C' })
    .returning();
  ids.c = c!.id;
});

beforeEach(() => {
  state.sessionUserId = undefined;
  for (const id of [userB, userC, inactiveId]) invalidateSessionUser(id);
});

afterAll(async () => {
  await state.handle?.close();
});

describe('GET /api/notifications', () => {
  it('비로그인·비활성 사용자는 401 봉투', async () => {
    expect((await get()).status).toBe(401);
    state.sessionUserId = inactiveId;
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('본인 알림만, 기본 20건, 최신순, no-store, 감사 로그 없음', async () => {
    state.sessionUserId = userB;
    const audits = await state.handle!.db.$count(auditLogs);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as NotificationsResponse;
    expect(body.unreadCount).toBe(25);
    expect(body.items).toHaveLength(20);
    expect(body.items[0]).toMatchObject({
      id: ids.b[0],
      title: 'B-0',
      href: '/pricing',
      read: false,
      important: false,
    });
    expect(body.items.some((item) => item.id === ids.c)).toBe(false);
    expect(Object.keys(body.items[0]!).sort()).toEqual(
      ['body', 'createdAt', 'href', 'id', 'important', 'read', 'title', 'type'].sort(),
    );
    expect(await state.handle!.db.$count(auditLogs)).toBe(audits);
  });

  it('limit 은 1..50 으로 자르고 잘못된 값은 기본 20', async () => {
    state.sessionUserId = userB;
    const len = async (query: string) =>
      ((await (await get(query)).json()) as NotificationsResponse).items.length;
    expect(await len('?limit=5')).toBe(5);
    expect(await len('?limit=0')).toBe(1);
    expect(await len('?limit=999')).toBe(25);
    expect(await len('?limit=abc')).toBe(20);
  });
});

describe('읽음 처리 Server Actions', () => {
  it('비로그인은 UNAUTHENTICATED 봉투', async () => {
    const result = await markAllNotificationsReadAction();
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('잘못된 id 는 VALIDATION 봉투', async () => {
    state.sessionUserId = userB;
    const result = await markNotificationReadAction({ id: 'not-a-uuid' });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('IDOR: 남의 알림 id 는 조용히 ok 이고 그 알림은 그대로', async () => {
    state.sessionUserId = userB;
    const result = await markNotificationReadAction({ id: ids.c });
    expect(result).toEqual({ ok: true, data: { unreadCount: 25 } });
    const [row] = await state
      .handle!.db.select()
      .from(notifications)
      .where(eq(notifications.id, ids.c));
    expect(row!.readAt).toBeNull();
  });

  it('본인 알림 읽음 → unreadCount 감소, 감사 로그 없음', async () => {
    state.sessionUserId = userB;
    const audits = await state.handle!.db.$count(auditLogs);
    expect(await markNotificationReadAction({ id: ids.b[0]! })).toEqual({
      ok: true,
      data: { unreadCount: 24 },
    });
    const body = (await (await get('?limit=1')).json()) as NotificationsResponse;
    expect(body.items[0]).toMatchObject({ id: ids.b[0], read: true });
    expect(await state.handle!.db.$count(auditLogs)).toBe(audits);
  });

  it('모두 읽음 → 0, 다시 조회해도 0, 남의 알림은 그대로', async () => {
    state.sessionUserId = userB;
    expect(await markAllNotificationsReadAction()).toEqual({ ok: true, data: { unreadCount: 0 } });
    expect(((await (await get()).json()) as NotificationsResponse).unreadCount).toBe(0);
    state.sessionUserId = userC;
    expect(((await (await get()).json()) as NotificationsResponse).unreadCount).toBe(1);
  });
});
