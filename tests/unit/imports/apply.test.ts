// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, importBatches, items, policyApplyRuns, salesPrices } from '@/db/schema';
import { AppError } from '@/lib/result';
import { applyPolicy, APPLY_STEPS, type ApplyInput } from '@/server/imports/apply-policy';
import { checkInvariants } from '@/server/imports/invariants';
import { getCurrentApply, listRecentRuns, listReusableBatches } from '@/server/imports/queries';
import { computeSeries, salesSeriesKey } from '@/server/imports/series';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/** §4.4 적용 1~6단계, AC-20~25 (200행 픽스처 + 합성 품목조회) */
let handle: DbHandle;
let salesId: string;
let itemsV1Id: string;
let itemsV2Id: string;

const ctx = () => ({ handle, actor: TEST_ACTOR, meta: TEST_META });
const input = (overrides: Partial<ApplyInput> = {}): ApplyInput => ({
  salesBatchId: salesId,
  itemBatchId: null,
  salesReused: false,
  itemReused: false,
  ...overrides,
});

const countErp = async () => handle.db.$count(salesPrices, eq(salesPrices.source, 'erp'));
const snapshot = async () =>
  handle.db
    .select({
      id: salesPrices.id,
      status: salesPrices.operationStatus,
      latest: salesPrices.isLatestInSeries,
    })
    .from(salesPrices)
    .orderBy(salesPrices.id);

beforeAll(async () => {
  handle = await createTestDb();
  salesId = (await uploadFixture(handle, 'sales', 'sales-200.xlsx')).batchId;
  itemsV1Id = (await uploadFixture(handle, 'items', 'items-v1.xlsx')).batchId;
  itemsV2Id = (await uploadFixture(handle, 'items', 'items-v2.xlsx')).batchId;
});

afterAll(async () => {
  await handle.close();
});

describe('업로드', () => {
  it('배치 parsed·스테이징·감사 import.upload, 미리보기 20행', async () => {
    const [batch] = await handle.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, salesId));
    expect(batch).toMatchObject({
      status: 'parsed',
      rowCount: 200,
      errorCount: 0,
      kind: 'sales_price',
    });
    const logs = await handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'import.upload'));
    expect(logs.some((log) => log.targetId === salesId)).toBe(true);
  });

  it('AC-24: 같은 파일 재업로드는 409(CONFLICT) + 기존 배치 id', async () => {
    const error = await uploadFixture(handle, 'sales', 'sales-200.xlsx').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
    expect((error as AppError).details).toMatchObject({ existingBatchId: salesId });
  });

  it('확장자·빈 파일 검증', async () => {
    await expect(uploadFixture(handle, 'sales', 'x.csv', Buffer.from('a'))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(uploadFixture(handle, 'sales', 'x.xlsx', Buffer.alloc(0))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});

describe('적용 — 판매단가만 (품목조회 없음)', () => {
  it('AC-20/21: 200행 적재, 불변식 0, 계열 결과가 순수 함수와 일치', async () => {
    const result = await applyPolicy(ctx(), input());
    expect(result.stats).toMatchObject({ inserted: 200, manualConflicts: 0, itemsApplied: 0 });
    expect(await countErp()).toBe(200);
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });

    const rows = await handle.db.select().from(salesPrices).orderBy(salesPrices.id);
    const expected = computeSeries(rows);
    rows.forEach((row, index) => {
      expect(row.seriesKey).toBe(salesSeriesKey(row));
      expect(row.isLatestInSeries).toBe(expected[index]!.isLatest);
      expect(row.effectiveTo).toBe(expected[index]!.effectiveTo);
    });
    // 원본 최종여부와 산정 결과 일치 (§12: 불일치는 단가유형 NULL 행에서만 생길 수 있음)
    const mismatched = rows.filter((row) => row.isFinalSource !== row.isLatestInSeries);
    expect(mismatched.every((row) => row.priceType === null)).toBe(true);
    expect(result.stats.finalSourceMismatch).toBe(mismatched.length);
  });

  it('AC-21 샘플: P2002030005 DBMS변경 2018-01-01 행의 effective_to = 2022-02-01', async () => {
    const rows = await handle.db
      .select()
      .from(salesPrices)
      .where(sql`${salesPrices.itemCode} = 'P2002030005' and ${salesPrices.priceType} = 'DBMS변경'`)
      .orderBy(salesPrices.effectiveFrom);
    expect(rows[0]).toMatchObject({
      effectiveFrom: '2018-01-01',
      effectiveTo: '2022-02-01',
      isLatestInSeries: false,
      operationStatus: '미사용',
    });
    expect(rows.at(-1)).toMatchObject({
      effectiveTo: null,
      isLatestInSeries: true,
      operationStatus: '운영중',
    });
  });

  it('품목 마스터가 없으면 모든 품번이 stub(미확인) 으로 집계된다', async () => {
    const current = await getCurrentApply(handle.db);
    const stubs = await handle.db.$count(items, sql`${items.raw}->>'stub' = 'true'`);
    expect(current?.stats?.missingItems).toBe(stubs);
    expect(current).toMatchObject({ sales: { id: salesId }, item: null });
  });
});

describe('적용 — 품목조회 반영 (3·4단계, AC-22/23)', () => {
  it('AC-24 ①: 판매단가 기존 재사용 + 품목 신규 → run 이 선택 배치를 가리킴', async () => {
    const result = await applyPolicy(ctx(), input({ itemBatchId: itemsV1Id, salesReused: true }));
    const [run] = await handle.db
      .select()
      .from(policyApplyRuns)
      .where(eq(policyApplyRuns.id, result.runId));
    expect(run).toMatchObject({
      salesBatchId: salesId,
      itemBatchId: itemsV1Id,
      salesReused: true,
      itemReused: false,
      status: 'succeeded',
    });
    expect(result.stats.itemsApplied).toBeGreaterThan(0);
    expect(result.stats.missingItems).toBe(3);
    expect(result.stats.unmappedItemStatus).toBe(1);
  });

  it('AC-22: 품목상태 라벨 매핑(사용/임시/폐기), 매핑 불가 라벨은 NULL + 원문 보존', async () => {
    const byStatus = await handle.db
      .select({
        status: items.itemStatus,
        raw: items.itemStatusRaw,
        count: sql<number>`count(*)::int`,
      })
      .from(items)
      .groupBy(items.itemStatus, items.itemStatusRaw);
    expect(byStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: '폐기', raw: '폐기', count: 2 }),
        expect.objectContaining({ status: '임시', raw: '임시', count: 1 }),
        expect.objectContaining({ status: null, raw: '보류', count: 1 }),
      ]),
    );
    const parts = await handle.db.$count(items, eq(items.itemKind, '파츠'));
    expect(parts).toBeGreaterThan(0);
  });

  it('AC-23: 폐기 품목의 최신 행은 미사용, I-1 = 0', async () => {
    const rows = await handle.db.execute(sql`
      select sp.operation_status, sp.is_latest_in_series from sales_prices sp
      join items i on i.item_code = sp.item_code where i.item_status = '폐기'`);
    const list = (
      rows as unknown as { rows: { operation_status: string; is_latest_in_series: boolean }[] }
    ).rows;
    expect(list.some((row) => row.is_latest_in_series)).toBe(true);
    expect(list.every((row) => row.operation_status === '미사용')).toBe(true);
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });
  });

  it('AC-24 ②: 판매단가 기존 + 품목 다른 배치(v2) → 해당 품번이 폐기로 바뀌어 미사용, v1 은 superseded', async () => {
    const before = (await getCurrentApply(handle.db))!.stats!.discardedForced;
    const result = await applyPolicy(ctx(), input({ itemBatchId: itemsV2Id, salesReused: true }));
    expect(result.stats.discardedForced).toBeGreaterThanOrEqual(before);
    const [v1] = await handle.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, itemsV1Id));
    expect(v1?.status).toBe('superseded');
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });
  });

  it('AC-24 ③: 둘 다 기존 재사용 (v1 다시 선택)', async () => {
    const result = await applyPolicy(
      ctx(),
      input({ itemBatchId: itemsV1Id, salesReused: true, itemReused: true }),
    );
    const [run] = await handle.db
      .select()
      .from(policyApplyRuns)
      .where(eq(policyApplyRuns.id, result.runId));
    expect(run).toMatchObject({
      salesBatchId: salesId,
      itemBatchId: itemsV1Id,
      salesReused: true,
      itemReused: true,
    });
    expect((await getCurrentApply(handle.db))?.item?.id).toBe(itemsV1Id);
    const reusable = await listReusableBatches(handle.db, 'item_master');
    expect(reusable.map((batch) => batch.id)).toEqual(
      expect.arrayContaining([itemsV1Id, itemsV2Id]),
    );
  });
});

describe('실패·거부 (AC-25)', () => {
  it('오류 있는 배치(행 오류)·헤더 누락 배치는 적용 거부, DB 변경 없음', async () => {
    const errors = await uploadFixture(handle, 'sales', 'sales-row-errors.xlsx');
    const missing = await uploadFixture(handle, 'sales', 'sales-header-missing.xlsx');
    expect(missing).toMatchObject({ status: 'failed', errorCount: 1 });
    expect(missing.errors[0]?.message).toContain('단가(1코어)');
    const before = await snapshot();
    for (const batchId of [errors.batchId, missing.batchId]) {
      await expect(applyPolicy(ctx(), input({ salesBatchId: batchId }))).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each(APPLY_STEPS)('실패 주입(%s 이후) → 전부 롤백, run failed, 감사 error', async (step) => {
    const before = await snapshot();
    const itemsBefore = await handle.db.select().from(items).orderBy(items.itemCode);
    const error = await applyPolicy(
      { ...ctx(), failAfter: step },
      input({ itemBatchId: itemsV2Id }),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'INTERNAL' });
    expect((error as AppError).message).toContain('기존 데이터는 변경되지 않았습니다');
    expect(await snapshot()).toEqual(before);
    expect(await handle.db.select().from(items).orderBy(items.itemCode)).toEqual(itemsBefore);
    const [latest] = await listRecentRuns(handle.db, 1);
    expect(latest).toMatchObject({ status: 'failed', error: expect.stringContaining(step) });
  });

  it('없는 배치 id 는 NOT_FOUND', async () => {
    await expect(
      applyPolicy(ctx(), input({ salesBatchId: '00000000-0000-4000-8000-000000000000' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('5단계 — 수동 등록 행 (§4.4.5)', () => {
  it('같은 계열·적용시작일 manual 은 ERP 우선으로 soft delete + 감사, 다른 manual 은 보존', async () => {
    const [erp] = await handle.db
      .select()
      .from(salesPrices)
      .where(eq(salesPrices.isLatestInSeries, true))
      .limit(1);
    if (!erp) throw new Error('fixture');
    const { id: _id, seriesKey: _k, createdAt: _c, updatedAt: _u, ...base } = erp;
    void _id;
    void _k;
    void _c;
    void _u;
    // ERP 행을 수동 행으로 바꿔 두면(관리 화면 수정, PR-4) 재임포트 때 같은 키로 충돌한다
    await handle.db
      .update(salesPrices)
      .set({ source: 'manual', importBatchId: null })
      .where(eq(salesPrices.id, erp.id));
    await handle.db.insert(salesPrices).values({
      ...base,
      source: 'manual',
      importBatchId: null,
      effectiveFrom: '2099-01-01',
      isFinalSource: false,
    });

    const result = await applyPolicy(
      ctx(),
      input({ itemBatchId: itemsV1Id, salesReused: true, itemReused: true }),
    );
    expect(result.stats).toMatchObject({ manualConflicts: 1, manualPreserved: 1, inserted: 200 });
    const [conflicted] = await handle.db
      .select()
      .from(salesPrices)
      .where(eq(salesPrices.id, erp.id));
    expect(conflicted?.deletedAt).toBeInstanceOf(Date);
    expect(conflicted).toMatchObject({ isLatestInSeries: false, operationStatus: '미사용' });
    const logs = await handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'price_policy.superseded_by_import'));
    expect(logs.some((log) => log.targetId === String(erp.id))).toBe(true);
    // 미래 적용시작일 manual 행이 계열의 최신이 된다
    const [future] = await handle.db
      .select()
      .from(salesPrices)
      .where(eq(salesPrices.effectiveFrom, '2099-01-01'));
    expect(future?.isLatestInSeries).toBe(true);
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });
  });
});
