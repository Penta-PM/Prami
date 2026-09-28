import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { parsePriceFilter } from '@/features/pricing/filter';
import { applyPolicy } from '@/server/imports/apply-policy';
import { queryCount } from '@/server/imports/sql-rows';
import { uploadImport } from '@/server/imports/upload';
import { getPriceRows } from '@/server/pricing/queries';

import { fixtureBytes, TEST_ACTOR, TEST_META, XLSX_MIME } from '../helpers/imports';

/** AC-10 — 실제 PostgreSQL 16 에서 날짜 필터 결과가 스펙 SQL 조건과 같은지 교차 검증 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);

describe.skipIf(!enabled)('PostgreSQL (DB_DRIVER=pg) 가격정책 조회', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
    const ctx = { handle, actor: TEST_ACTOR, meta: TEST_META };
    let salesBatchId: string;
    try {
      salesBatchId = (
        await uploadImport(ctx, {
          kind: 'sales',
          fileName: 'sales-200.xlsx',
          mimeType: XLSX_MIME,
          bytes: fixtureBytes('sales-200.xlsx'),
        })
      ).batchId;
    } catch (error) {
      salesBatchId = (error as { details: { existingBatchId: string } }).details.existingBatchId;
    }
    await applyPolicy(ctx, {
      salesBatchId,
      itemBatchId: null,
      salesReused: true,
      itemReused: false,
    });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('적용시작일 기준·적용기간 기준 총건수 = 스펙 SQL 조건 건수', async () => {
    const start = await getPriceRows(
      handle.db,
      parsePriceFilter({ from: '2024-01-01', to: '2024-12-31' }).filter,
    );
    expect(start.total).toBe(
      await queryCount(
        handle.db,
        sql`select count(*)::int as n from sales_prices where deleted_at is null
            and effective_from between '2024-01-01' and '2024-12-31'`,
      ),
    );
    const period = await getPriceRows(
      handle.db,
      parsePriceFilter({ dateMode: 'period', from: '2024-06-01', to: '2024-06-30' }).filter,
    );
    expect(period.total).toBe(
      await queryCount(
        handle.db,
        sql`select count(*)::int as n from sales_prices where deleted_at is null
            and effective_from <= '2024-06-30' and (effective_to is null or effective_to > '2024-06-01')`,
      ),
    );
    expect(period.total).toBeGreaterThan(0);
  });
});
