import { readFileSync } from 'node:fs';

import { eq } from 'drizzle-orm';
import { inject } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import * as schema from '@/db/schema';
import { auditLogs, users, type NewUser, type User } from '@/db/schema';

/** globalSetup 이 떠 둔 마이그레이션 템플릿 — 프로세스(워커)마다 한 번만 읽는다 */
let templateBlob: Blob | null | undefined;

function pgliteTemplate(): Blob | null {
  if (templateBlob !== undefined) return templateBlob;
  let file: string | undefined;
  try {
    file = inject('pgliteTemplate');
  } catch {
    file = undefined; // globalSetup 없이 도는 프로젝트(integration 등)
  }
  templateBlob = file ? new Blob([readFileSync(file)]) : null;
  return templateBlob;
}

/**
 * 마이그레이션을 적용한 인메모리 PGlite 핸들 (파일마다 독립 DB).
 * unit 프로젝트에서는 globalSetup(tests/global-pglite-template.ts)의 마이그레이션 템플릿을 loadDataDir 로 복원한다 —
 * 파일마다 약 3s 걸리던 마이그레이션을 약 0.75s 복원으로 바꾼다 (CI 사용량 절감 PR-C). 템플릿이 없으면 예전처럼 마이그레이션.
 */
export async function createTestDb(): Promise<DbHandle> {
  const template = pgliteTemplate();
  if (!template) {
    const handle = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
    await migrateDb(handle);
    return handle;
  }
  const [{ PGlite }, { pg_trgm }, { citext }, { pgcrypto }, { drizzle }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pg_trgm'),
    import('@electric-sql/pglite/contrib/citext'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
    import('drizzle-orm/pglite'),
  ]);
  // 확장 목록은 src/db/index.ts createPgliteDb 와 같다
  const client = await PGlite.create({
    loadDataDir: template,
    extensions: { pg_trgm, citext, pgcrypto },
  });
  return { db: drizzle({ client, schema }), driver: 'pglite', close: () => client.close() };
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
