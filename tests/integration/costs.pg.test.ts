import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { costAccessForTests } from '@/server/cost/access-token';
import { applyCostImport } from '@/server/cost/apply-costs';
import { parseCostFilter } from '@/server/cost/filter';
import { getCostRows } from '@/server/cost/queries';
import { COST_I2_VIOLATIONS_SQL } from '@/server/cost/series';
import { queryCount } from '@/server/imports/sql-rows';
import { uploadImport } from '@/server/imports/upload';

import { fixtureBytes, TEST_ACTOR, TEST_META, XLSX_MIME } from '../helpers/imports';

/**
 * AC-40 / 요구 14 — 실제 PostgreSQL 16 에서 같은 날짜 중복(Main 결정 B) 적재, 계열 재계산(window SQL),
 * 날짜 두 모드가 스펙 SQL 조건과 같은지 교차 검증. 0002 마이그레이션(UNIQUE → 일반 인덱스)도 함께 검증된다.
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);
const access = costAccessForTests({ id: null, email: 'vitest-pg' });

describe.skipIf(!enabled)('PostgreSQL (DB_DRIVER=pg) 원가 적용·조회', () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
    const ctx = { handle, actor: TEST_ACTOR, meta: TEST_META };
    let batchId: string;
    try {
      batchId = (
        await uploadImport(ctx, {
          kind: 'costs',
          fileName: 'costs-dup.xlsx',
          mimeType: XLSX_MIME,
          bytes: fixtureBytes('costs-dup.xlsx'),
        })
      ).batchId;
    } catch (error) {
      batchId = (error as { details: { existingBatchId: string } }).details.existingBatchId;
    }
    await applyCostImport({ handle, access, meta: TEST_META }, { batchId, reused: true });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('같은 계열·같은 날짜 2행이 모두 적재되고(UNIQUE 제거) I-2 위반 0', async () => {
    expect(
      await queryCount(
        handle.db,
        sql`select count(*)::int as n from material_costs where deleted_at is null
            and material_code = 'W40100002' and effective_from = '2025-01-01'`,
      ),
    ).toBe(2);
    expect(await queryCount(handle.db, COST_I2_VIOLATIONS_SQL)).toBe(0);
    expect(
      await queryCount(
        handle.db,
        sql`select count(*)::int as n from pg_indexes where tablename = 'material_costs'
            and indexname = 'material_costs_series_effective_uq'`,
      ),
    ).toBe(0);
  });

  it('적용시작일 기준·적용기간 기준 총건수 = 스펙 SQL 조건 건수', async () => {
    const start = await getCostRows(
      access,
      handle.db,
      parseCostFilter({ from: '2025-01-01', to: '2025-12-31' }).filter,
    );
    expect(start.total).toBe(
      await queryCount(
        handle.db,
        sql`select count(*)::int as n from material_costs where deleted_at is null
            and effective_from between '2025-01-01' and '2025-12-31'`,
      ),
    );
    const period = await getCostRows(
      access,
      handle.db,
      parseCostFilter({ dateMode: 'period', from: '2024-06-01', to: '2024-06-30' }).filter,
    );
    expect(period.total).toBe(
      await queryCount(
        handle.db,
        sql`select count(*)::int as n from material_costs where deleted_at is null
            and effective_from <= '2024-06-30' and (effective_to is null or effective_to > '2024-06-01')`,
      ),
    );
    expect(period.total).toBeGreaterThan(0);
  });
});
