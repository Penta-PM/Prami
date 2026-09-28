import { existsSync, readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { applyPolicy } from '@/server/imports/apply-policy';
import { checkInvariants } from '@/server/imports/invariants';
import { queryRows } from '@/server/imports/sql-rows';
import { uploadImport } from '@/server/imports/upload';

import { fixtureBytes, TEST_ACTOR, TEST_META, XLSX_MIME } from '../helpers/imports';

/**
 * AC-20~25 — 실제 PostgreSQL 16 (DB_DRIVER=pg). 임포트 적용·롤백이 PGlite 와 같은 결과인지 확인한다.
 * 다른 테스트 데이터와 겹치지 않도록 고유 바이트(파일 끝 공백)를 붙이지 않고, 기존 배치가 있으면 재사용한다.
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);
const SOURCE =
  process.env.SOURCE_XLSX ??
  'C:/Users/USER/orca/workspaces/Prami/_inputs/PRAMI-001/병합_가격_raw.xlsx';

describe.skipIf(!enabled)('PostgreSQL (DB_DRIVER=pg) 임포트 파이프라인', () => {
  let handle: DbHandle;
  const ctx = () => ({ handle, actor: TEST_ACTOR, meta: TEST_META });

  async function batchFor(kind: 'sales' | 'items', name: string, bytes = fixtureBytes(name)) {
    try {
      return (await uploadImport(ctx(), { kind, fileName: name, mimeType: XLSX_MIME, bytes }))
        .batchId;
    } catch (error) {
      const details = (error as { details?: { existingBatchId?: string } }).details;
      if (details?.existingBatchId) return details.existingBatchId;
      throw error;
    }
  }

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('200행 + 품목조회 적용 → 불변식 0, 실패 주입은 롤백', async () => {
    const salesBatchId = await batchFor('sales', 'sales-200.xlsx');
    const itemBatchId = await batchFor('items', 'items-v1.xlsx');
    const input = { salesBatchId, itemBatchId, salesReused: false, itemReused: false };
    const { stats } = await applyPolicy(ctx(), input);
    expect(stats).toMatchObject({ inserted: 200, missingItems: 3, unmappedItemStatus: 1 });
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });

    const before = await queryRows<{ id: number }>(
      handle.db,
      sql`select id from sales_prices order by id`,
    );
    await expect(applyPolicy({ ...ctx(), failAfter: 'verify' }, input)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    const after = await queryRows<{ id: number }>(
      handle.db,
      sql`select id from sales_prices order by id`,
    );
    expect(after).toEqual(before);
  });

  it.skipIf(!existsSync(SOURCE))('원본 5,885행 전체 적재 (AC-20/21)', async () => {
    const salesBatchId = await batchFor('sales', '병합_가격_raw.xlsx', readFileSync(SOURCE));
    const { stats } = await applyPolicy(ctx(), {
      salesBatchId,
      itemBatchId: null,
      salesReused: false,
      itemReused: false,
    });
    expect(stats).toMatchObject({ inserted: 5885, seriesCount: 3810, finalSourceMismatch: 0 });
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });
    console.info('[pg AC-20/21] stats', JSON.stringify(stats));
  });
});
