// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { importBatches, items, partMappings, salesPrices, stgPartMappings } from '@/db/schema';
import { AppError } from '@/lib/result';
import { applyPolicy } from '@/server/imports/apply-policy';
import { applyPartImport } from '@/server/parts/apply-parts';
import { listPartsCatalog, listProductFamilies, sortFamilies } from '@/server/parts/catalog';
import {
  deletePartMapping,
  ensureItemStubs,
  savePartMapping,
  type PartsContext,
} from '@/server/parts/mutations';
import { getPartMapping, listPartMappings } from '@/server/parts/queries';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 파츠 관리 서버 (§4.3.6, §4.5.6, R-02): 후보 분류(품명 N_ 규칙), 모델별 전체 교체 저장(AC-30·31),
 * 엑셀 적용(AC-32), items stub 규칙, 감사.
 */
let handle: DbHandle;
let ctx: PartsContext;
const N_51080 = 'P10800011';
const N_51240 = 'P10800009';

beforeAll(async () => {
  handle = await createTestDb();
  const admin = await insertUser(handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' });
  ctx = { handle, actor: { id: admin.id, label: admin.email }, meta: TEST_META };
  const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
  // 종류는 품목 마스터 적용 시 저장된 값만 쓴다 (PRAMI-003 §4.2.7) — 합성 품목 마스터(실데이터 분류)를 함께 적용
  const itemsBatch = await uploadFixture(handle, 'items', 'items-v1.xlsx');
  await applyPolicy(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    {
      salesBatchId: sales.batchId,
      itemBatchId: itemsBatch.batchId,
      salesReused: false,
      itemReused: false,
    },
  );
});

afterAll(async () => {
  await handle.close();
});

async function firstModel() {
  const catalog = await listPartsCatalog(handle.db, 'WAPPLES');
  return catalog.models[0]!;
}

describe('listPartsCatalog / listProductFamilies', () => {
  it('제품군 탭 = 판매단가 product_family, 모델 = 저장된 종류 본품, 파츠 = 저장된 종류 파츠', async () => {
    const families = await listProductFamilies(handle.db);
    expect(families).toContain('WAPPLES');
    const catalog = await listPartsCatalog(handle.db, 'WAPPLES');
    expect(catalog.parts.map((item) => item.itemCode)).toContain(N_51080);
    expect(catalog.parts.every((item) => item.kind === '파츠')).toBe(true);
    expect(catalog.models.some((item) => item.itemCode === N_51080)).toBe(false);
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.models.every((item) => item.kind === '본품')).toBe(true);
  });

  it('AC-313: 품명으로 판정하지 않는다 — 판매단가 품명을 SSD·기술지원비로 바꿔도 종류 불변, stub 품번은 기타(목록 제외)', async () => {
    const model = await firstModel();
    for (const itemName of ['SSD 2TB', '기술지원비(M/D)', 'NIC N_51080']) {
      await handle.db
        .update(salesPrices)
        .set({ itemName })
        .where(eq(salesPrices.itemCode, model.itemCode));
      const catalog = await listPartsCatalog(handle.db, 'WAPPLES');
      expect(catalog.models.some((item) => item.itemCode === model.itemCode)).toBe(true);
      expect(catalog.parts.some((item) => item.itemCode === model.itemCode)).toBe(false);
    }
    await handle.db
      .update(salesPrices)
      .set({ itemName: model.itemName })
      .where(eq(salesPrices.itemCode, model.itemCode));
    const stubs = await handle.db
      .select({ code: items.itemCode })
      .from(items)
      .where(eq(items.source, 'stub'));
    expect(stubs.length).toBeGreaterThan(0);
    const all = await listPartsCatalog(handle.db, 'WAPPLES');
    const listed = new Set([...all.models, ...all.parts].map((item) => item.itemCode));
    expect(stubs.some(({ code }) => listed.has(code))).toBe(false);
  });

  it('PR-6 QA INFO-2: 제품군 탭 순서 = 홈 카드 순서, iSIGN PKI 는 iSIGN 다음', () => {
    expect(sortFamilies(['Cloudbric', 'D.AMO', 'iSIGN', 'iSIGN PKI', 'WAPPLES', 'ZZ'])).toEqual([
      'WAPPLES',
      'D.AMO',
      'iSIGN',
      'iSIGN PKI',
      'Cloudbric',
      'ZZ',
    ]);
  });

  it('저장된 item_kind 를 그대로 쓴다 (본품 → 파츠로 바꾸면 파츠 목록)', async () => {
    const model = await firstModel();
    await handle.db
      .update(items)
      .set({ itemKind: '파츠' })
      .where(eq(items.itemCode, model.itemCode));
    const catalog = await listPartsCatalog(handle.db, 'WAPPLES');
    expect(catalog.parts.some((item) => item.itemCode === model.itemCode)).toBe(true);
    await handle.db
      .update(items)
      .set({ itemKind: '본품' })
      .where(eq(items.itemCode, model.itemCode));
  });
});

describe('savePartMapping / listPartMappings (AC-30, AC-31)', () => {
  it('모델 선택 + 파츠 2건 저장 → 표에 모델 1행·파츠 2건, 감사 part_mapping.save', async () => {
    const model = await firstModel();
    const result = await savePartMapping(ctx, {
      modelItemCode: model.itemCode,
      partItemCodes: [N_51080, N_51240, N_51080],
    });
    expect(result).toEqual({
      modelItemCode: model.itemCode,
      partItemCodes: [N_51080, N_51240],
      replaced: false,
    });
    const groups = await listPartMappings(handle.db, 'WAPPLES');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ modelItemCode: model.itemCode, modelName: model.itemName });
    expect(groups[0]!.parts.map((part) => part.itemCode)).toEqual([N_51080, N_51240]);
    expect(groups[0]!.parts[0]!.itemName).toMatch(/^N_51080/);
    expect(await handle.db.$count(partMappings)).toBe(2);
    const [log] = await auditByAction(handle, 'part_mapping.save');
    expect(log).toMatchObject({ targetId: model.itemCode, before: null });
    expect(log!.after).toEqual({ partItemCodes: [N_51080, N_51240] });
  });

  it('같은 모델 재저장 → 기존 삭제 후 교체(replaced), UNIQUE 위반 없음, 감사 before 에 이전 목록', async () => {
    const model = await firstModel();
    const result = await savePartMapping(ctx, {
      modelItemCode: model.itemCode,
      partItemCodes: [N_51240],
    });
    expect(result.replaced).toBe(true);
    expect(await getPartMapping(handle.db, model.itemCode)).toEqual([N_51240]);
    expect(await handle.db.$count(partMappings)).toBe(1);
    const logs = await auditByAction(handle, 'part_mapping.save');
    expect(logs.at(-1)!.before).toEqual({ partItemCodes: [N_51080, N_51240] });
    // 다른 제품군 필터에서는 보이지 않는다
    expect(await listPartMappings(handle.db, 'D.AMO')).toEqual([]);
  });

  it('존재하지 않는 품번·모델 자신·빈 목록은 거부', async () => {
    const model = await firstModel();
    const unknown = await savePartMapping(ctx, {
      modelItemCode: model.itemCode,
      partItemCodes: ['NOPE-0000'],
    }).catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(AppError);
    expect((unknown as AppError).code).toBe('VALIDATION');
    expect((unknown as AppError).fieldErrors?.partItemCodes?.[0]).toContain('NOPE-0000');
    await expect(
      savePartMapping(ctx, { modelItemCode: model.itemCode, partItemCodes: [model.itemCode] }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(
      savePartMapping(ctx, { modelItemCode: model.itemCode, partItemCodes: [] }),
    ).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('판매단가에만 있는 품번은 items stub 으로 만들어 FK 를 만족시킨다 (§4.3.6)', async () => {
    await handle.db.delete(items).where(eq(items.itemCode, N_51080));
    expect(await ensureItemStubs(handle.db as never, [N_51080, 'NOPE-1'])).toEqual(['NOPE-1']);
    const [stub] = await handle.db.select().from(items).where(eq(items.itemCode, N_51080));
    expect(stub).toMatchObject({
      itemName: expect.stringMatching(/^N_51080/),
      source: 'stub',
      itemKind: null,
    });
  });

  it('삭제 → 매핑 0건, 감사 part_mapping.delete, 재삭제는 NOT_FOUND', async () => {
    const model = await firstModel();
    expect(await deletePartMapping(ctx, { modelItemCode: model.itemCode })).toEqual({
      modelItemCode: model.itemCode,
      removed: 1,
    });
    expect(await listPartMappings(handle.db)).toEqual([]);
    expect((await auditByAction(handle, 'part_mapping.delete')).at(-1)).toMatchObject({
      before: { partItemCodes: [N_51240] },
    });
    await expect(deletePartMapping(ctx, { modelItemCode: model.itemCode })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('applyPartImport (AC-32)', () => {
  it('오류 행이 있는 배치(존재하지 않는 품번)는 적용 불가', async () => {
    const upload = await uploadFixture(handle, 'parts', 'parts-sample.xlsx');
    expect(upload.errorCount).toBeGreaterThanOrEqual(1);
    expect(upload.errors.some((error) => error.value === 'NOPE-0000')).toBe(true);
    await expect(
      applyPartImport(ctx, { batchId: upload.batchId, reused: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('검증 통과 배치 → 모델별 전체 교체, 배치 applied, 감사 part_import.apply, 재적용 멱등', async () => {
    const [model, other] = (await listPartsCatalog(handle.db, 'WAPPLES')).models;
    await savePartMapping(ctx, { modelItemCode: model!.itemCode, partItemCodes: [N_51240] });
    const [batch] = await handle.db
      .insert(importBatches)
      .values({
        kind: 'part_mapping',
        fileName: 'parts-ok.xlsx',
        fileSha256: 'x'.repeat(64),
        fileSize: 10,
        rowCount: 3,
        errorCount: 0,
        status: 'parsed',
      })
      .returning({ id: importBatches.id });
    await handle.db.insert(stgPartMappings).values([
      { batchId: batch!.id, rowIndex: 2, modelItemCode: model!.itemCode, partItemCode: N_51080 },
      { batchId: batch!.id, rowIndex: 3, modelItemCode: model!.itemCode, partItemCode: N_51080 },
      { batchId: batch!.id, rowIndex: 4, modelItemCode: other!.itemCode, partItemCode: N_51240 },
    ]);
    const stats = await applyPartImport(ctx, { batchId: batch!.id, reused: false });
    expect(stats).toEqual({ models: 2, mappings: 2, replacedModels: 1 });
    const groups = await listPartMappings(handle.db, 'WAPPLES');
    expect(
      groups.map((group) => [group.modelItemCode, group.parts.map((p) => p.itemCode)]),
    ).toEqual(
      expect.arrayContaining([
        [model!.itemCode, [N_51080]],
        [other!.itemCode, [N_51240]],
      ]),
    );
    const [applied] = await handle.db
      .select({ status: importBatches.status })
      .from(importBatches)
      .where(eq(importBatches.id, batch!.id));
    expect(applied?.status).toBe('applied');
    expect((await auditByAction(handle, 'part_import.apply')).at(-1)).toMatchObject({
      targetId: batch!.id,
      result: 'success',
    });
    expect(await applyPartImport(ctx, { batchId: batch!.id, reused: true })).toEqual({
      models: 2,
      mappings: 2,
      replacedModels: 2,
    });
    expect(await handle.db.$count(partMappings)).toBe(2);
  });
});
