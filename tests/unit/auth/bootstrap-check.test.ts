// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { NO_ADMIN_WARNING, warnIfNoAdmin } from '@/server/auth/bootstrap-check';

import { createTestDb, insertUser } from '../../helpers/pglite';

/** §4.6.1: ADMIN_EMAILS 가 비어 있고 ADMIN 이 0명이면 기동 시 경고 */
let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

describe('warnIfNoAdmin', () => {
  it('ADMIN_EMAILS 가 있으면 검사하지 않는다', async () => {
    const warn = vi.fn();
    expect(await warnIfNoAdmin(handle.db, ['a@pentasecurity.com'], warn)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('비어 있고 활성 ADMIN 이 0명이면 경고, ADMIN 이 생기면 조용하다', async () => {
    const warn = vi.fn();
    await insertUser(handle, { email: 'off@pentasecurity.com', role: 'ADMIN', status: 'inactive' });
    expect(await warnIfNoAdmin(handle.db, [], warn)).toBe(true);
    expect(warn).toHaveBeenCalledWith(NO_ADMIN_WARNING);

    await insertUser(handle, { email: 'on@pentasecurity.com', role: 'ADMIN' });
    expect(await warnIfNoAdmin(handle.db, [], warn)).toBe(false);
  });
});
