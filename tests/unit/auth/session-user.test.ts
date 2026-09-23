// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { users } from '@/db/schema';
import {
  invalidateSessionUser,
  loadSessionUser,
  SESSION_USER_TTL_MS,
} from '@/server/auth/session-user';

import { createTestDb, insertUser } from '../../helpers/pglite';

/** §4.6.1 비활성 사용자: 기존 JWT 도 매 요청 DB 조회(캐시 60초)로 차단 */
let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

describe('loadSessionUser', () => {
  it('60초 동안 캐시하고, 만료 후 비활성화를 반영해 null 을 돌려준다', async () => {
    const user = await insertUser(handle, { email: 'cache@pentasecurity.com', role: 'USER' });
    const now = 1_000_000;

    expect(await loadSessionUser(handle.db, user.id, now)).toMatchObject({ role: 'USER' });
    await handle.db.update(users).set({ status: 'inactive' }).where(eq(users.id, user.id));

    expect(await loadSessionUser(handle.db, user.id, now + 1_000)).not.toBeNull();
    expect(await loadSessionUser(handle.db, user.id, now + SESSION_USER_TTL_MS + 1)).toBeNull();
  });

  it('invalidateSessionUser 로 역할 변경을 즉시 반영한다', async () => {
    const user = await insertUser(handle, { email: 'promote@pentasecurity.com', role: 'USER' });
    expect((await loadSessionUser(handle.db, user.id))?.role).toBe('USER');

    await handle.db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, user.id));
    invalidateSessionUser(user.id);
    expect((await loadSessionUser(handle.db, user.id))?.role).toBe('ADMIN');

    invalidateSessionUser();
    expect(await loadSessionUser(handle.db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
