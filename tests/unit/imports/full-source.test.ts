// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { applyPolicy } from '@/server/imports/apply-policy';
import { checkInvariants } from '@/server/imports/invariants';
import { queryRows } from '@/server/imports/sql-rows';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/**
 * AC-20/21 — 원본 `병합_가격_raw.xlsx` 5,885행 전체 (읽기 전용 입력). 파일이 없는 환경(CI)에서는 스킵.
 * 경로: SOURCE_XLSX 환경변수 또는 Main 이 준비한 _inputs 경로.
 */
const SOURCE =
  process.env.SOURCE_XLSX ??
  'C:/Users/USER/orca/workspaces/Prami/_inputs/PRAMI-001/병합_가격_raw.xlsx';
const available = existsSync(SOURCE);

describe.skipIf(!available)('원본 5,885행 전체 적재 (AC-20/21)', () => {
  let handle: DbHandle;
  let batchId: string;

  beforeAll(async () => {
    handle = await createTestDb();
    const upload = await uploadFixture(handle, 'sales', '병합_가격_raw.xlsx', readFileSync(SOURCE));
    batchId = upload.batchId;
    expect(upload).toMatchObject({ status: 'parsed', rowCount: 5885, errorCount: 0 });
  }, 120_000);

  afterAll(async () => {
    await handle?.close();
  });

  it('적용 후 ERP 5,885행, §12 프로파일 통계, I-1·I-2 0', async () => {
    const { stats } = await applyPolicy(
      { handle, actor: TEST_ACTOR, meta: TEST_META },
      { salesBatchId: batchId, itemBatchId: null, salesReused: false, itemReused: false },
    );
    expect(stats.inserted).toBe(5885);
    const [profile] = await queryRows<Record<string, number>>(
      handle.db,
      sql`select count(*)::int as rows,
        count(distinct product_family)::int as families,
        count(distinct currency)::int as currencies,
        count(*) filter (where price_type is null)::int as null_price_type,
        count(distinct item_code)::int as item_codes,
        count(*) filter (where customer_code <> '0')::int as customer_rows,
        count(*) filter (where is_final_source)::int as final_true
      from sales_prices where source = 'erp'`,
    );
    expect(profile).toEqual({
      rows: 5885,
      families: 5,
      currencies: 3,
      null_price_type: 11,
      item_codes: 1495,
      customer_rows: 28,
      final_true: 3810,
    });
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });
    console.info('[AC-20/21] stats', JSON.stringify(stats));
  }, 120_000);

  it('AC-21: 원본 최종여부와 is_latest 불일치는 단가유형 NULL 행에서만 (≤ 11건)', async () => {
    const rows = await queryRows<{ price_type: string | null; n: number }>(
      handle.db,
      sql`select price_type, count(*)::int as n from sales_prices
          where source = 'erp' and is_final_source <> is_latest_in_series group by price_type`,
    );
    expect(rows.every((row) => row.price_type === null)).toBe(true);
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    expect(total).toBeLessThanOrEqual(11);
    const [match] = await queryRows<{ rate: string }>(
      handle.db,
      sql`select round(100.0 * count(*) filter (where is_final_source = is_latest_in_series) / count(*), 3)::text as rate
          from sales_prices where source = 'erp'`,
    );
    console.info('[AC-21] 최종여부 불일치', total, '일치율 %', match?.rate);
  });

  it('AC-21 샘플: P2002030005 DBMS변경 2018-01-01 → effective_to 2022-02-01', async () => {
    const rows = await queryRows<{ effective_from: string; effective_to: string | null }>(
      handle.db,
      sql`select effective_from::text, effective_to::text from sales_prices
          where item_code = 'P2002030005' and price_type = 'DBMS변경' order by effective_from`,
    );
    expect(rows[0]).toEqual({ effective_from: '2018-01-01', effective_to: '2022-02-01' });
  });
});
