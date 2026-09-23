// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { auditLogs, notices, users } from '@/db/schema';
import { SEED_AUDIT_ACTION, SEED_NOTICES, SEED_USERS, seedDatabase } from '@/db/seed';

import { countRows } from '../../helpers/db-introspect';

/** AC-02 (PR-1 범위): pnpm seed 후 픽스처 ADMIN·USER 가 users 에 있고 audit_logs 에 user.seed 가 남는다 */
let handle: DbHandle;

beforeAll(async () => {
  handle = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
  await migrateDb(handle);
});

afterAll(async () => {
  await handle.close();
});

describe('seedDatabase', () => {
  it('픽스처 ADMIN·USER 각 1명과 공지 샘플, user.seed 감사 로그를 만든다', async () => {
    const result = await seedDatabase(handle);

    expect(result.users.map((u) => u.role).sort()).toEqual(['ADMIN', 'USER']);
    expect(result.noticeCount).toBe(SEED_NOTICES.length);
    expect(result.auditLogCount).toBe(SEED_USERS.length);

    const storedUsers = await handle.db.select().from(users);
    expect(storedUsers).toHaveLength(2);
    expect(storedUsers.every((u) => u.createdVia === 'admin' && u.status === 'active')).toBe(true);

    const seedLogs = await handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, SEED_AUDIT_ACTION));
    expect(seedLogs).toHaveLength(2);
    expect(seedLogs.map((l) => l.targetId).sort()).toEqual(storedUsers.map((u) => u.id).sort());
    expect(seedLogs[0]?.actorLabel).toBe('seed');
  });

  it('재실행하면 사용자·공지는 갱신(upsert)되고 감사 로그만 추가된다', async () => {
    await seedDatabase(handle);

    expect(await countRows(handle.db, 'users')).toBe(2);
    expect(await countRows(handle.db, 'notices')).toBe(SEED_NOTICES.length);
    expect(await countRows(handle.db, 'audit_logs')).toBe(SEED_USERS.length * 2);
  });

  it('이메일은 대소문자를 구분하지 않는다 (citext)', async () => {
    const [admin] = await handle.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.email, 'FIXTURE-ADMIN@PENTASECURITY.COM'));
    expect(admin?.email).toBe('fixture-admin@pentasecurity.com');
  });

  it('공지의 작성자는 픽스처 ADMIN 이다', async () => {
    const [admin] = await handle.db.select().from(users).where(eq(users.role, 'ADMIN'));
    const storedNotices = await handle.db.select().from(notices);
    expect(storedNotices.every((n) => n.authorUserId === admin?.id)).toBe(true);
    expect(storedNotices.filter((n) => n.isImportant)).toHaveLength(1);
  });
});
