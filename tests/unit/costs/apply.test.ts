// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { importBatches, materialCosts } from '@/db/schema';
import { AppError } from '@/lib/result';
import { costAccessForTests } from '@/server/cost/access-token';
import { applyCostImport } from '@/server/cost/apply-costs';
import { parseCostFilter } from '@/server/cost/filter';
import {
  getCostRows,
  getCurrentCostApply,
  listCostFamilies,
  listCostYears,
} from '@/server/cost/queries';
import { COST_I2_VIOLATIONS_SQL, recomputeCostSeriesSql } from '@/server/cost/series';
import { queryCount } from '@/server/imports/sql-rows';

import { TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb } from '../../helpers/pglite';

/** §4.4.7 원가 임포트 적용 + 조회 (AC-40), Main 결정 B: 같은 날짜 중복 적재·tie-break·경고 */
const SOURCE =
  process.env.SOURCE_COSTS_XLSX ??
  'C:/Users/USER/orca/workspaces/Prami/_inputs/PRAMI-001/원자재코드 정보_260825.xlsx';

let handle: DbHandle;
const access = costAccessForTests({ id: null, email: 'vitest' });
const ctx = () => ({ handle, access, meta: TEST_META });
const filter = (params: Record<string, string>) => parseCostFilter(params).filter;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

describe('costs-sample (3행)', () => {
  it('적용 → ERP 행·제품군 파생·최신 판정, 배치 applied, 감사 cost_import.apply', async () => {
    const upload = await uploadFixture(handle, 'costs', 'costs-sample.xlsx');
    expect(upload).toMatchObject({ status: 'parsed', rowCount: 3, errorCount: 0 });
    const stats = await applyCostImport(ctx(), { batchId: upload.batchId, reused: false });
    expect(stats).toMatchObject({
      inserted: 3,
      materialCount: 2,
      seriesCount: 2,
      latestCount: 2,
      duplicateDateGroups: 0,
    });

    const rows = await handle.db.select().from(materialCosts).orderBy(materialCosts.id);
    expect(rows.map((row) => row.productFamily)).toEqual(['WAPPLES', 'WAPPLES', 'D.AMO']);
    expect(rows[0]).toMatchObject({
      isLatestInSeries: false,
      operationStatus: '미사용',
      effectiveTo: '2025-01-01',
    });
    expect(rows[1]).toMatchObject({
      isLatestInSeries: true,
      operationStatus: '운영중',
      effectiveTo: null,
    });
    const [batch] = await handle.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, upload.batchId));
    expect(batch?.status).toBe('applied');
    expect((await auditByAction(handle, 'cost_import.apply')).at(-1)).toMatchObject({
      targetId: upload.batchId,
      result: 'success',
    });
    expect(await getCurrentCostApply(access, handle.db)).toMatchObject({ batchId: upload.batchId });
  });

  it('오류 있는 배치·없는 배치는 거부', async () => {
    await expect(
      applyCostImport(ctx(), { batchId: '00000000-0000-4000-8000-000000000000', reused: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
    await expect(
      applyCostImport(ctx(), { batchId: sales.batchId, reused: false }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('costs-dup (같은 날짜 중복, Main 결정 B)', () => {
  it('업로드: 중복은 오류가 아니라 경고 — 값 동일 1건, 값 다름 1건(별도 컬럼명)', async () => {
    const upload = await uploadFixture(handle, 'costs', 'costs-dup.xlsx');
    expect(upload).toMatchObject({ status: 'parsed', rowCount: 7, errorCount: 0 });
    expect(upload.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: '같은 날짜 중복',
          message: expect.stringContaining('값 동일'),
        }),
        expect.objectContaining({
          column: '같은 날짜 중복(값 다름)',
          message: expect.stringContaining('300000.00 ≠ 280000.00'),
        }),
      ]),
    );
    const stats = await applyCostImport(ctx(), { batchId: upload.batchId, reused: false });
    expect(stats).toMatchObject({
      inserted: 7,
      materialCount: 3,
      seriesCount: 3,
      latestCount: 3,
      duplicateDateGroups: 2,
    });
    expect(await queryCount(handle.db, COST_I2_VIOLATIONS_SQL)).toBe(0);

    // 같은 날짜 중복 두 행: 둘 다 적재, 종료일은 다음 "다른" 시작일(2026-01-01), 둘 다 미사용
    const dups = await handle.db
      .select()
      .from(materialCosts)
      .where(
        sql`${materialCosts.materialCode} = 'W40100002' and ${materialCosts.effectiveFrom} = '2025-01-01'`,
      )
      .orderBy(materialCosts.id);
    expect(dups.map((row) => row.unitCost)).toEqual(['300000.00', '280000.00']);
    expect(
      dups.every((row) => row.effectiveTo === '2026-01-01' && row.operationStatus === '미사용'),
    ).toBe(true);
  });

  it('tie-break: 같은 계열·같은 최신 날짜면 파일 순서 뒤 행(id 큰 행)이 최신 — 결정적', async () => {
    const base = {
      materialCode: 'W9TIE',
      materialName: 'tie',
      unit: 'EA',
      priceType: '표준구매원가',
      priceCategory: '일반',
      currency: 'KRW',
      effectiveFrom: '2030-01-01',
      isFinalSource: false,
      appliesToAllCustomers: false,
      source: 'erp' as const,
      productFamily: '기타',
    };
    const inserted = await handle.db
      .insert(materialCosts)
      .values([
        { ...base, unitCost: '100.00' },
        { ...base, unitCost: '200.00' },
      ])
      .returning({ id: materialCosts.id });
    for (let run = 0; run < 3; run += 1) {
      await handle.db.execute(recomputeCostSeriesSql(['W9TIE|표준구매원가|일반|KRW']));
      const rows = await handle.db
        .select()
        .from(materialCosts)
        .where(eq(materialCosts.materialCode, 'W9TIE'))
        .orderBy(materialCosts.id);
      expect(rows.map((row) => row.isLatestInSeries)).toEqual([false, true]);
      expect(rows[1]!.id).toBe(inserted[1]!.id);
      expect(rows.map((row) => row.effectiveTo)).toEqual([null, null]);
    }
    expect(await queryCount(handle.db, COST_I2_VIOLATIONS_SQL)).toBe(0);
  });
});

describe('조회 (§4.5.5, 요구 14: 날짜 두 모드 SQL 교차 검증)', () => {
  it('제품군 탭·연도·검색·페이지', async () => {
    const families = await listCostFamilies(access, handle.db);
    expect(families.map((tab) => tab.family)).toEqual(['WAPPLES', 'D.AMO', 'iSIGN', '기타']);
    expect(await listCostYears(access, handle.db)).toEqual([2030, 2026, 2025, 2024]);
    const wapples = await getCostRows(access, handle.db, filter({ family: 'WAPPLES' }));
    expect(wapples.rows.every((row) => row.productFamily === 'WAPPLES')).toBe(true);
    expect((await getCostRows(access, handle.db, filter({ q: 'iSIGN' }))).total).toBe(3);
    expect((await getCostRows(access, handle.db, filter({ q: '%' }))).total).toBe(0);
  });

  it('적용시작일 기준·적용기간 기준 총건수 = §4.5.2 SQL 조건', async () => {
    const start = await getCostRows(
      access,
      handle.db,
      filter({ from: '2025-01-01', to: '2025-12-31' }),
    );
    expect(start.total).toBe(
      await queryCount(
        handle.db,
        sql`select count(*)::int as n from material_costs where deleted_at is null and effective_from between '2025-01-01' and '2025-12-31'`,
      ),
    );
    expect(start.rows.every((row) => row.effectiveFrom.startsWith('2025'))).toBe(true);
    // 2024-06 에 적용시작한 행은 없지만(시작일 기준 0), 2024-01-01 시작 행들은 그 기간에 유효(기간 기준 > 0)
    const june = { from: '2024-06-01', to: '2024-06-30' };
    expect((await getCostRows(access, handle.db, filter(june))).total).toBe(0);
    const period = await getCostRows(access, handle.db, filter({ dateMode: 'period', ...june }));
    expect(period.total).toBe(
      await queryCount(
        handle.db,
        sql`select count(*)::int as n from material_costs where deleted_at is null and effective_from <= '2024-06-30' and (effective_to is null or effective_to > '2024-06-01')`,
      ),
    );
    expect(period.total).toBeGreaterThan(0);
    expect(
      period.rows.every(
        (row) =>
          row.effectiveFrom <= '2024-06-30' &&
          (row.effectiveTo === null || row.effectiveTo > '2024-06-01'),
      ),
    ).toBe(true);
  });

  it('토큰 없이 조회하면 던진다 (첫 줄 검사)', async () => {
    await expect(getCostRows(null as never, handle.db, filter({}))).rejects.toThrow(/토큰/);
  });
});

describe.skipIf(!existsSync(SOURCE))('AC-40 원본 원자재코드 정보_260825.xlsx', () => {
  it('487행 적재, 최신 157, I-2 0, 최종여부 = 최신 판정 100%, 제품군 파생', async () => {
    const own = await createTestDb();
    try {
      const upload = await uploadFixture(
        own,
        'costs',
        '원자재코드 정보_260825.xlsx',
        readFileSync(SOURCE),
      );
      expect(upload).toMatchObject({ status: 'parsed', rowCount: 487, errorCount: 0 });
      expect(upload.warnings.filter((w) => w.column.startsWith('같은 날짜 중복'))).toHaveLength(3);
      const stats = await applyCostImport(
        { handle: own, access, meta: TEST_META },
        { batchId: upload.batchId, reused: false },
      );
      expect(stats).toMatchObject({
        inserted: 487,
        materialCount: 157,
        seriesCount: 157,
        latestCount: 157,
        otherFamilyRows: 5,
        duplicateDateGroups: 3,
      });
      expect(await queryCount(own.db, COST_I2_VIOLATIONS_SQL)).toBe(0);
      expect(
        await queryCount(
          own.db,
          sql`select count(*)::int as n from material_costs where is_final_source <> is_latest_in_series`,
        ),
      ).toBe(0);
      const families = await listCostFamilies(access, own.db);
      expect(families).toEqual([
        { family: 'WAPPLES', count: 294 },
        { family: 'D.AMO', count: 80 },
        { family: 'iSIGN', count: 108 },
        { family: '기타', count: 5 },
      ]);
    } finally {
      await own.close();
    }
  }, 60_000);
});
