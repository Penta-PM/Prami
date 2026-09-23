import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { auditLogs, users } from '@/db/schema';
import { SEED_AUDIT_ACTION, seedDatabase } from '@/db/seed';

import {
  dbShape,
  EXPECTED_EXTENSIONS,
  EXPECTED_TABLES,
  SALES_PRICE_SOURCE_COLUMNS,
} from '../fixtures/sales-prices-columns';
import { describeColumns, listExtensions, listTables } from '../helpers/db-introspect';

/**
 * AC-01/AC-02 — 실제 PostgreSQL 16 (DB_DRIVER=pg). 로컬 docker compose 또는 CI service container.
 * DATABASE_URL 이 없으면 전체 스킵한다 (단위 테스트는 PGlite 로 같은 검사를 수행).
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);

describe.skipIf(!enabled)('PostgreSQL (DB_DRIVER=pg) 마이그레이션 · 시드', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('§4.3 전 테이블과 확장이 존재한다', async () => {
    expect(await listTables(handle.db)).toEqual([...EXPECTED_TABLES]);
    const extensions = await listExtensions(handle.db);
    for (const name of EXPECTED_EXTENSIONS) expect(extensions).toContain(name);
  });

  it('sales_prices 원본 20컬럼이 스펙 §4.3.1 과 일치한다 (PGlite 스냅샷과 동일 기준)', async () => {
    const actual = await describeColumns(handle.db, 'sales_prices');
    expect(actual.slice(1, 21)).toEqual(SALES_PRICE_SOURCE_COLUMNS.map(dbShape));
  });

  it('seed 후 픽스처 ADMIN·USER 와 user.seed 감사 로그가 있다', async () => {
    const result = await seedDatabase(handle);
    expect(result.users).toHaveLength(2);

    const roles = (await handle.db.select({ role: users.role }).from(users)).map((u) => u.role);
    expect(roles).toEqual(expect.arrayContaining(['ADMIN', 'USER']));

    const seedLogs = await handle.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.action, SEED_AUDIT_ACTION));
    expect(seedLogs.length).toBeGreaterThanOrEqual(2);
  });
});
