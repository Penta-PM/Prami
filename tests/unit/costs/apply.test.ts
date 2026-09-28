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
import { queryCount, queryRows } from '@/server/imports/sql-rows';

import { TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb } from '../../helpers/pglite';

/**
 * §4.4.7 원가 임포트 적용 + 조회 (AC-40), 스펙 r4(Main 결정 B): 같은 날짜 중복은 경고, 전부 적재,
 * `source_row` 뒤 행 우선 tie-break, 앞 행 effective_to = 자기 시작일, 2회 적용 결정성.
 */
const SOURCE =
  process.env.SOURCE_COSTS_XLSX ??
  'C:/Users/USER/orca/workspaces/Prami/_inputs/PRAMI-001/원자재코드 정보_260825.xlsx';

let handle: DbHandle;
const access = costAccessForTests({ id: null, email: 'vitest' });
const ctx = () => ({ handle, access, meta: TEST_META });
const filter = (params: Record<string, string>) => parseCostFilter(params).filter;
const DUP_WHERE = sql`${materialCosts.materialCode} = 'W40100002' and ${materialCosts.effectiveFrom} = '2025-01-01'`;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

describe('costs-sample (3행)', () => {
  it('적용 → ERP 행·제품군 파생·source_row·최신 판정, 배치 applied, 감사 cost_import.apply', async () => {
    const upload = await uploadFixture(handle, 'costs', 'costs-sample.xlsx');
    expect(upload).toMatchObject({ status: 'parsed', rowCount: 3, errorCount: 0 });
    expect(upload.duplicateWarnings).toEqual({ sameDateDuplicates: [], conflictingDuplicates: [] });
    const { stats, warnings } = await applyCostImport(ctx(), {
      batchId: upload.batchId,
      reused: false,
    });
    expect(stats).toMatchObject({
      inserted: 3,
      materialCount: 2,
      seriesCount: 2,
      latestCount: 2,
      sameDateDuplicateGroups: 0,
    });
    expect(warnings).toEqual({ sameDateDuplicates: [], conflictingDuplicates: [] });

    const rows = await handle.db.select().from(materialCosts).orderBy(materialCosts.id);
    expect(rows.map((row) => row.productFamily)).toEqual(['WAPPLES', 'WAPPLES', 'D.AMO']);
    expect(rows.map((row) => row.sourceRow)).toEqual([1, 2, 3]);
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

describe('costs-dup (같은 날짜 중복, r4 §4.4.7)', () => {
  it('업로드: 오류가 아니라 경고 — 그룹 2개(값 동일 1·값 다름 1), 행 경고에도 남는다 → 적용 가능', async () => {
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
    // 그룹 경고 (§4.4.7 r4 3): sourceRows 는 헤더 다음 행 = 1 기준
    expect(upload.duplicateWarnings.sameDateDuplicates).toHaveLength(2);
    expect(upload.duplicateWarnings.conflictingDuplicates).toEqual([
      {
        seriesKey: 'W40100002|표준구매원가|일반|KRW',
        effectiveFrom: '2025-01-01',
        sourceRows: [5, 6],
        unitCosts: ['300000.00', '280000.00'],
      },
    ]);

    const { stats, warnings } = await applyCostImport(ctx(), {
      batchId: upload.batchId,
      reused: false,
    });
    expect(stats).toMatchObject({
      inserted: 7,
      materialCount: 3,
      seriesCount: 3,
      latestCount: 3,
      sameDateDuplicateGroups: 2,
    });
    expect(warnings).toEqual(upload.duplicateWarnings);
    expect(await queryCount(handle.db, COST_I2_VIOLATIONS_SQL)).toBe(0);

    // ③④ 같은 날짜 두 행 모두 적재(source_row 5·6), 둘 다 최신 아님·미사용,
    // 앞 행(5) effective_to = 자기 시작일(기간 0일), 뒤 행(6) effective_to = 다음 시작일
    const dups = await handle.db
      .select()
      .from(materialCosts)
      .where(DUP_WHERE)
      .orderBy(materialCosts.sourceRow);
    expect(
      dups.map((row) => [row.sourceRow, row.unitCost, row.effectiveTo, row.isLatestInSeries]),
    ).toEqual([
      [5, '300000.00', '2025-01-01', false],
      [6, '280000.00', '2026-01-01', false],
    ]);
    expect(dups.every((row) => row.operationStatus === '미사용')).toBe(true);
  });

  it('⑥ 결정성: 같은 파일을 다시 적용해도 ③④ 결과가 같다', async () => {
    const [batch] = await handle.db
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(eq(importBatches.status, 'applied'));
    const snapshot = () =>
      handle.db
        .select({
          sourceRow: materialCosts.sourceRow,
          effectiveTo: materialCosts.effectiveTo,
          latest: materialCosts.isLatestInSeries,
        })
        .from(materialCosts)
        .where(DUP_WHERE)
        .orderBy(materialCosts.sourceRow);
    const before = await snapshot();
    await applyCostImport(ctx(), { batchId: batch!.id, reused: true });
    expect(await snapshot()).toEqual(before);
    expect(before).toEqual([
      { sourceRow: 5, effectiveTo: '2025-01-01', latest: false },
      { sourceRow: 6, effectiveTo: '2026-01-01', latest: false },
    ]);
    expect(await queryCount(handle.db, COST_I2_VIOLATIONS_SQL)).toBe(0);
  });

  it('tie-break: 같은 계열·같은 최신 날짜면 source_row 큰(원본 뒤) 행이 최신, manual(NULL)은 뒤로 — 반복해도 동일', async () => {
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
    // id 순서와 source_row 순서를 일부러 엇갈리게 넣는다 (id 가 아니라 source_row 가 기준)
    const inserted = await handle.db
      .insert(materialCosts)
      .values([
        { ...base, unitCost: '100.00', sourceRow: 900 },
        { ...base, unitCost: '200.00', sourceRow: 800 },
        { ...base, unitCost: '300.00', sourceRow: null, source: 'manual' as const },
      ])
      .returning({ id: materialCosts.id });
    for (let run = 0; run < 3; run += 1) {
      await handle.db.execute(recomputeCostSeriesSql(['W9TIE|표준구매원가|일반|KRW']));
      const rows = await handle.db
        .select()
        .from(materialCosts)
        .where(eq(materialCosts.materialCode, 'W9TIE'))
        .orderBy(materialCosts.id);
      expect(rows.map((row) => row.isLatestInSeries)).toEqual([true, false, false]);
      expect(rows[0]!.id).toBe(inserted[0]!.id);
      expect(rows.map((row) => row.effectiveTo)).toEqual([null, '2030-01-01', '2030-01-01']);
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
  it('①~⑥: 487행·최신 157, 경고 3그룹·값 다름 1, 중복 6행 최신 아님·앞 행 effective_to=시작일, I-2 0, 2회 적용 동일', async () => {
    const own = await createTestDb();
    const ownCtx = { handle: own, access, meta: TEST_META };
    try {
      const upload = await uploadFixture(
        own,
        'costs',
        '원자재코드 정보_260825.xlsx',
        readFileSync(SOURCE),
      );
      // ① 배치는 failed 가 아니다(오류 0) → 적용 가능
      expect(upload).toMatchObject({ status: 'parsed', rowCount: 487, errorCount: 0 });
      // ② 경고 3그룹, 값 다름 1그룹 (W1001020034 2025-01-01)
      expect(
        upload.duplicateWarnings.sameDateDuplicates.map((g) => [
          g.seriesKey.split('|')[0],
          g.effectiveFrom,
        ]),
      ).toEqual([
        ['W1001020015', '2021-01-01'],
        ['W1001020016', '2021-01-01'],
        ['W1001020034', '2025-01-01'],
      ]);
      expect(upload.duplicateWarnings.conflictingDuplicates).toEqual([
        expect.objectContaining({
          seriesKey: 'W1001020034|표준구매원가|일반|KRW',
          effectiveFrom: '2025-01-01',
          unitCosts: ['573000.00', '504000.00'],
        }),
      ]);
      const first = await applyCostImport(ownCtx, { batchId: upload.batchId, reused: false });
      expect(first.stats).toMatchObject({
        inserted: 487,
        materialCount: 157,
        seriesCount: 157,
        latestCount: 157,
        otherFamilyRows: 5,
        sameDateDuplicateGroups: 3,
      });
      expect(first.warnings.conflictingDuplicates).toHaveLength(1);

      const observe = async () => {
        // ③ 중복 SQL = 3그룹 6행, 모두 최신 아님 ④ effective_to = 자기 시작일인 행은 source_row 가 작은 행
        const groups = await queryRows<{ rows: number[]; latest: boolean[]; zeroSpan: number[] }>(
          own.db,
          sql`select array_agg(source_row order by source_row) as rows,
                     array_agg(is_latest_in_series order by source_row) as latest,
                     array_agg(source_row order by source_row) filter (where effective_to = effective_from) as "zeroSpan"
              from material_costs where deleted_at is null
              group by series_key, effective_from having count(*) > 1 order by series_key`,
        );
        expect(groups).toHaveLength(3);
        for (const group of groups) {
          expect(group.rows).toHaveLength(2);
          expect(group.latest).toEqual([false, false]);
          expect(group.zeroSpan).toEqual([group.rows[0]]);
        }
        // ⑤ I-2 0건, 원본 최종여부 = 최신 판정, erp 행 source_row NOT NULL
        expect(await queryCount(own.db, COST_I2_VIOLATIONS_SQL)).toBe(0);
        expect(
          await queryCount(
            own.db,
            sql`select count(*)::int as n from material_costs where is_final_source <> is_latest_in_series`,
          ),
        ).toBe(0);
        expect(
          await queryCount(
            own.db,
            sql`select count(*)::int as n from material_costs where source = 'erp' and source_row is null`,
          ),
        ).toBe(0);
        return groups;
      };
      const before = await observe();
      // ⑥ 같은 파일 2회 적용 → 동일
      await applyCostImport(ownCtx, { batchId: upload.batchId, reused: true });
      expect(await observe()).toEqual(before);

      expect(await listCostFamilies(access, own.db)).toEqual([
        { family: 'WAPPLES', count: 294 },
        { family: 'D.AMO', count: 80 },
        { family: 'iSIGN', count: 108 },
        { family: '기타', count: 5 },
      ]);
    } finally {
      await own.close();
    }
  }, 90_000);
});
