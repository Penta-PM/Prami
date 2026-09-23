import { eq } from 'drizzle-orm';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { auditLogs, users, type NewUser, type User } from '@/db/schema';

/** 마이그레이션을 적용한 인메모리 PGlite 핸들 (파일마다 독립 DB) */
export async function createTestDb(): Promise<DbHandle> {
  const handle = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
  await migrateDb(handle);
  return handle;
}

export async function insertUser(handle: DbHandle, values: Partial<NewUser> & { email: string }) {
  const [row] = await handle.db
    .insert(users)
    .values({ name: values.email.split('@')[0] ?? 'user', createdVia: 'admin', ...values })
    .returning();
  if (!row) throw new Error('insertUser 실패');
  return row as User;
}

export async function findUserByEmail(handle: DbHandle, email: string) {
  const [row] = await handle.db.select().from(users).where(eq(users.email, email));
  return row;
}

export async function auditByAction(handle: DbHandle, action: string) {
  return handle.db.select().from(auditLogs).where(eq(auditLogs.action, action));
}
