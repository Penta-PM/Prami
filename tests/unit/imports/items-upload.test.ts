// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import readXlsxFile from 'read-excel-file/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { items, partMappings, policyApplyRuns, stgSalesPrices } from '@/db/schema';
import { AppError } from '@/lib/result';
import { applyPolicy, previewItemMerge } from '@/server/imports/apply-policy';
import { uploadItemFiles } from '@/server/imports/item-upload';
import { queryRows } from '@/server/imports/sql-rows';
import { getPriceRowDetail } from '@/server/pricing/queries';

import { fixtureBytes, TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import {
  cellOf,
  fixtureInputs,
  ITEM_FIXTURES,
  itemInput,
  itemXlsx,
  readItemFixture,
  withCell,
} from '../../helpers/items';
import { createTestDb } from '../../helpers/pglite';

/**
 * PRAMI-003 §4.2.3·§4.2.8 다중 파일 업로드·검증·병합 (CI — 축소 픽스처·합성 픽스처).
 * AC-304 다중/병합 파일, AC-305 검증 코드, AC-306 병합·전량 교체, AC-307 I-10 주입, AC-314 매핑 불일치 경고, AC-303 비고 ADMIN 전용.
 */
const ctx = (handle: DbHandle) => ({ handle, actor: TEST_ACTOR, meta: TEST_META });

describe('AC-304·AC-305 다중 파일 업로드 (축소 픽스처)', () => {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it('5파일 → 배치 1개, source_files 5건(이름·SHA-256·행 수), 개인정보 제외 정보 3', async () => {
    const inputs = await fixtureInputs();
    const result = await uploadItemFiles(ctx(handle), inputs);
    expect(result).toMatchObject({ status: 'parsed', errorCount: 0 });
    expect(result.sourceFiles!.map((file) => file.name)).toEqual(inputs.map((i) => i.fileName));
    expect(result.sourceFiles!.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true);
    expect(result.rowCount).toBe(result.sourceFiles!.reduce((sum, file) => sum + file.rowCount, 0));
    expect(result.warnings.find((w) => w.code === 'excluded_columns_dropped')?.value).toBe(3);
    expect(result.warnings.map((w) => w.code)).not.toContain('mixed_major_in_file');
  });

  it('5파일을 합친 병합 파일 1개 → 같은 행 수·품번 집합 (mixed_major_in_file 경고)', async () => {
    const sheets = await Promise.all(ITEM_FIXTURES.map(readItemFixture));
    const merged = await itemXlsx({
      header: sheets[0]!.header,
      rows: sheets.flatMap((s) => s.rows),
    });
    const result = await uploadItemFiles(ctx(handle), [itemInput('merged.xlsx', merged)]);
    expect(result).toMatchObject({
      status: 'parsed',
      errorCount: 0,
      rowCount: sheets.reduce((n, s) => n + s.rows.length, 0),
    });
    expect(result.warnings.map((w) => w.code)).toContain('mixed_major_in_file');
    const codes = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(distinct item_code)::int as n from stg_items where batch_id = ${result.batchId}`,
    );
    expect(codes[0]!.n).toBe(result.rowCount);
  });

  it('같은 파일 2개 → duplicate_file 오류, 배치 미생성', async () => {
    const [wapples] = await fixtureInputs(['wapples']);
    const error = await uploadItemFiles(ctx(handle), [
      wapples!,
      { ...wapples!, fileName: 'copy.xlsx' },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toMatchObject({
      errors: [expect.objectContaining({ code: 'duplicate_file', file: 'copy.xlsx' })],
    });
  });

  it('파일 간 같은 품번 → duplicate_item_code 오류(품번·두 파일명·행 번호), 배치 failed', async () => {
    const wapples = await readItemFixture('wapples');
    const cloudbric = await readItemFixture('cloudbric');
    const stolen = wapples.rows[0]!;
    const bad = await itemXlsx({ header: cloudbric.header, rows: [...cloudbric.rows, stolen] });
    const [wapplesInput] = await fixtureInputs(['wapples']);
    const result = await uploadItemFiles(ctx(handle), [
      wapplesInput!,
      itemInput('cloudbric-dup.xlsx', bad),
    ]);
    expect(result.status).toBe('failed');
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'duplicate_item_code',
        value: cellOf(wapples, stolen, '품번'),
        file: 'cloudbric-dup.xlsx',
        row: cloudbric.rows.length + 3,
        message: expect.stringContaining('wapples.xlsx 3행'),
      }),
    );
  });

  it('필수 헤더 누락 파일 → 업로드 오류(missing_required_header), 배치 미생성', async () => {
    const sheet = await readItemFixture('cloudbric');
    const index = sheet.header.indexOf('품목대분류');
    const broken = await itemXlsx({
      header: sheet.header.filter((_, i) => i !== index),
      rows: sheet.rows.map((row) => row.filter((_, i) => i !== index)),
    });
    const before = await handle.db.$count(sql`import_batches` as never);
    const error = await uploadItemFiles(ctx(handle), [itemInput('no-major.xlsx', broken)]).catch(
      (e: unknown) => e,
    );
    expect((error as AppError).details).toMatchObject({
      errors: [expect.objectContaining({ code: 'missing_required_header', file: 'no-major.xlsx' })],
    });
    expect(await handle.db.$count(sql`import_batches` as never)).toBe(before);
  });
});

describe('AC-305·AC-306·AC-307·AC-314 적용 (합성 품목 + 판매단가 200행)', () => {
  let handle: DbHandle;
  let salesId: string;
  let itemsV1Id: string;

  beforeAll(async () => {
    handle = await createTestDb();
    salesId = (await uploadFixture(handle, 'sales', 'sales-200.xlsx')).batchId;
    const v1 = await uploadItemFiles(ctx(handle), [
      itemInput('items-v1.xlsx', fixtureBytes('items-v1.xlsx')),
    ]);
    itemsV1Id = v1.batchId;
    // 판매단가를 아직 적용하지 않았으므로(업로드만) 이 시점에는 커버 경고가 없다
    expect(v1.warnings.find((w) => w.code === 'sales_items_not_covered')).toBeUndefined();
    await applyPolicy(ctx(handle), {
      salesBatchId: salesId,
      itemBatchId: itemsV1Id,
      salesReused: false,
      itemReused: false,
    });
  });
  afterAll(async () => {
    await handle.close();
  });

  const majors = async () =>
    (
      await queryRows<{ m: string; n: number }>(
        handle.db,
        sql`select category_major as m, count(*)::int as n from items where source = 'master' group by 1 order by 1`,
      )
    ).map((row) => [row.m, row.n] as const);

  it('AC-305: 판매단가 품번 3개가 빠진 품목 파일 → sales_items_not_covered=3 경고와 목록', async () => {
    const result = await uploadItemFiles(ctx(handle), [
      itemInput('items-v1-again.xlsx', await itemXlsxFromFixture('items-v1.xlsx')),
    ]);
    const warning = result.warnings.find((w) => w.code === 'sales_items_not_covered');
    expect(warning?.message).toContain('3개');
    expect(warning?.value).toHaveLength(3);
  });

  it('AC-306: 한 제품군만 업로드 → 병합 방식 없이는 VALIDATION(missing_families), 유지(병합)·전량 교체 각각', async () => {
    const before = await majors();
    expect(before.length).toBeGreaterThan(1);
    const [onlyMajor] = before[0]!;
    const v1 = await readItemFixtureFile('items-v1.xlsx');
    const majorIndex = v1.header.indexOf('품목대분류');
    const erp = {
      WAPPLES: 'WAPPLES',
      'D.AMO': "D'Amo",
      iSIGN: 'iSIGN+',
      'iSIGN PKI': 'iSIGN+ PKI',
      Cloudbric: 'Cloudbric',
    } as Record<string, string>;
    const subset = v1.rows.filter((row) => row[majorIndex] === erp[onlyMajor]);
    const renamed = subset.map((row) =>
      withCell(v1, row, '품명', `${String(cellOf(v1, row, '품명'))} (갱신)`),
    );
    const upload = await uploadItemFiles(ctx(handle), [
      itemInput('one-family.xlsx', await itemXlsx({ header: v1.header, rows: renamed })),
    ]);
    const missing = before.map(([m]) => m).filter((m) => m !== onlyMajor);
    expect(upload.itemMerge?.missingFamilies).toEqual(missing);
    expect(upload.warnings.find((w) => w.code === 'missing_families')?.value).toEqual(missing);
    const preview = await previewItemMerge(handle, upload.batchId);
    const vanishing = before.filter(([m]) => m !== onlyMajor).reduce((n, [, c]) => n + c, 0);
    expect(preview).toMatchObject({ missingFamilies: missing, vanishingItems: vanishing });

    const input = {
      salesBatchId: salesId,
      itemBatchId: upload.batchId,
      salesReused: true,
      itemReused: false,
    };
    await expect(applyPolicy(ctx(handle), input)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { code: 'missing_families', missingFamilies: missing },
    });

    const merged = await applyPolicy(ctx(handle), { ...input, itemMerge: 'merge' });
    expect(await majors()).toEqual(before);
    expect(merged.stats.itemMerge).toMatchObject({
      mode: 'merge',
      keptMajors: missing,
      droppedMajors: [],
      fromBatchId: itemsV1Id,
    });
    const [run] = await handle.db
      .select()
      .from(policyApplyRuns)
      .where(eq(policyApplyRuns.id, merged.runId));
    expect(run?.itemMerge).toMatchObject({ mode: 'merge', keptMajors: missing });
    const updated = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from items where category_major = ${onlyMajor} and item_name like '% (갱신)'`,
    );
    expect(updated[0]!.n).toBe(subset.length);

    const replaced = await applyPolicy(ctx(handle), { ...input, itemMerge: 'replace' });
    // QA L-3: 전량 교체에서 빠진 대분류는 keptMajors 가 아니라 droppedMajors 로 기록한다
    expect(replaced.stats.itemMerge).toMatchObject({
      mode: 'replace',
      keptMajors: [],
      droppedMajors: missing,
    });
    const [replacedRun] = await handle.db
      .select()
      .from(policyApplyRuns)
      .where(eq(policyApplyRuns.id, replaced.runId));
    expect(replacedRun?.itemMerge).toMatchObject({ keptMajors: [], droppedMajors: missing });
    expect(await majors()).toEqual([[onlyMajor, subset.length]]);
    const stubs = await handle.db.$count(items, eq(items.source, 'stub'));
    expect(stubs).toBeGreaterThanOrEqual(vanishing);
  });

  it('AC-307: I-10 위반(판매단가 제품군 ≠ 품목 대분류) 주입 → 경고 통계, 적용은 성공 / AC-314: 매핑 종류 불일치 경고, 매핑 유지', async () => {
    await applyPolicy(ctx(handle), {
      salesBatchId: salesId,
      itemBatchId: itemsV1Id,
      salesReused: true,
      itemReused: true,
      itemMerge: 'merge',
    });
    const [target] = await queryRows<{ item_code: string; m: string }>(
      handle.db,
      sql`select i.item_code, i.category_major as m from items i where source = 'master' limit 1`,
    );
    await handle.db
      .update(stgSalesPrices)
      .set({ productFamily: target!.m === 'WAPPLES' ? 'D.AMO' : 'WAPPLES' })
      .where(
        sql`${stgSalesPrices.batchId} = ${salesId} and ${stgSalesPrices.itemCode} = ${target!.item_code}`,
      );
    const [model] = await queryRows<{ item_code: string }>(
      handle.db,
      sql`select item_code from items where source = 'master' and item_kind <> '본품' limit 1`,
    );
    const [part] = await queryRows<{ item_code: string }>(
      handle.db,
      sql`select item_code from items where source = 'master' and item_code <> ${model!.item_code} limit 1`,
    );
    await handle.db
      .insert(partMappings)
      .values({ modelItemCode: model!.item_code, partItemCode: part!.item_code });
    const result = await applyPolicy(ctx(handle), {
      salesBatchId: salesId,
      itemBatchId: itemsV1Id,
      salesReused: true,
      itemReused: true,
    });
    expect(result.stats.i10Violations).toBe(1);
    expect(result.stats.i10Samples).toEqual([target!.item_code]);
    expect(result.stats.partMappingMismatch!.models).toBeGreaterThanOrEqual(1);
    expect(await handle.db.$count(partMappings)).toBe(1);
  });

  it('AC-303: 품목 상세의 ERP 비고는 ADMIN(includeRemark) 응답에만, ERP 대분류 원문은 공통', async () => {
    const [row] = await queryRows<{ id: number }>(
      handle.db,
      sql`select sp.id from sales_prices sp join items i on i.item_code = sp.item_code
          where i.source = 'master' and i.raw ? '비고' and sp.deleted_at is null limit 1`,
    );
    const user = await getPriceRowDetail(handle.db, row!.id);
    const admin = await getPriceRowDetail(handle.db, row!.id, { includeRemark: true });
    expect(user!.row).not.toHaveProperty('erpRemark');
    expect(admin!.row.erpRemark).toMatch(/^비고 /);
    expect(user!.row.erpMajor).toBeTruthy();
  });
});

/** tests/fixtures/imports 의 합성 품목 파일 (1행 제목 + 2행 헤더) */
async function readItemFixtureFile(name: string) {
  const [sheet] = await readXlsxFile(fixtureBytes(name));
  const data = (sheet?.data ?? []) as unknown[][];
  return {
    title: data[0] ?? [],
    header: (data[1] ?? []).map((cell) => String(cell ?? '').trim()),
    rows: data.slice(2),
  };
}

/** 합성 픽스처를 다시 써서 SHA 가 다른 같은 내용 파일로 */
async function itemXlsxFromFixture(name: string) {
  const sheet = await readItemFixtureFile(name);
  return itemXlsx({ header: sheet.header, rows: sheet.rows.map((row) => [...row]) });
}
