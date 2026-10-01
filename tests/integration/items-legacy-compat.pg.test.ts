import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { queryRows } from '@/server/imports/sql-rows';

import { LEGACY_EXPECTED_ROWS, runLegacyItemWrites } from '../helpers/legacy-item-writes';

/**
 * PRAMI-003 PR-1 QA M-1 — 실제 PostgreSQL 16: 최신 스키마(0006 포함)에서 직전 앱(da1b186·1605ad7)의 items 쓰기 3경로가
 * 성공하고 불완전한 행은 stub 이 된다. 0005 만 적용한 DB 의 실패 재현은 PGlite 단위 테스트(migration-0006.test.ts)가 맡는다.
 * 공유 DB 의 다른 테스트 데이터와 섞이지 않도록 트랜잭션 안에서 실행하고 롤백한다.
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);

class Rollback extends Error {}

describe.skipIf(!enabled)('PostgreSQL 구버전 앱 items 쓰기 호환 (QA M-1)', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('판매단가 stub·파츠 stub·구 품목 배치 적용이 성공하고, master 는 완전한 행만 남는다', async () => {
    let rows: unknown;
    let violations = -1;
    await handle.db
      .transaction(async (tx) => {
        await tx.execute(sql`delete from items where item_code in
          ('PLEGACYNEW', 'PMASTER1', 'PMASTER2', 'PPARTNEW', 'PSALESNEW')`);
        const all = await runLegacyItemWrites(tx, `pg-${Date.now()}`);
        rows = all.filter((row) => LEGACY_EXPECTED_ROWS.some((e) => e.item_code === row.item_code));
        const [count] = await queryRows<{ n: number }>(
          tx,
          sql`select count(*)::int as n from items where source = 'master'
              and (item_kind is null or item_status is null or category_major is null)`,
        );
        violations = count!.n;
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(rows).toEqual(LEGACY_EXPECTED_ROWS);
    expect(violations).toBe(0);
  });
});
