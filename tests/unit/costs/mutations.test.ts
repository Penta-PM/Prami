// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { materialCosts } from '@/db/schema';
import { AppError } from '@/lib/result';
import { costAccessForTests } from '@/server/cost/access-token';
import { applyCostImport } from '@/server/cost/apply-costs';
import {
  createMaterialCost,
  deleteMaterialCost,
  updateMaterialCost,
  upsertMaterialCost,
} from '@/server/cost/mutations';
import { COST_I2_VIOLATIONS_SQL } from '@/server/cost/series';
import { queryCount } from '@/server/imports/sql-rows';

import { TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb } from '../../helpers/pglite';

/**
 * 원가 등록·수정·삭제 (§4.5.5, §4.4.7 r4 4 upsertMaterialCost): 사유 필수, source manual, 계열 재계산,
 * 감사 12컬럼 스냅샷, 같은 계열·적용시작일 앱 검사(ERP 행 포함, AC-40 ⑦)
 */
let handle: DbHandle;
const access = costAccessForTests({ id: null, email: 'vitest' }, 'write');
const ctx = () => ({ handle, access, meta: TEST_META });

const rowsOf = (code: string) =>
  handle.db
    .select()
    .from(materialCosts)
    .where(eq(materialCosts.materialCode, code))
    .orderBy(materialCosts.id);

const NEW_COST = {
  materialCode: 'W10100016',
  materialName: 'WAPPLES-100 T4',
  unit: 'EA',
  priceType: '표준구매원가',
  priceCategory: '일반',
  currency: 'krw',
  unitCost: '1234567',
  effectiveFrom: '2027-01-01',
  reason: '2027 계약',
};

beforeAll(async () => {
  handle = await createTestDb();
  const upload = await uploadFixture(handle, 'costs', 'costs-sample.xlsx');
  await applyCostImport(ctx(), { batchId: upload.batchId, reused: false });
});

afterAll(async () => {
  await handle.close();
});

describe('createMaterialCost / upsertMaterialCost (AC-40 ⑦)', () => {
  it('같은 계열·적용시작일이 ERP 행에 이미 있으면 CONFLICT + fieldErrors.effectiveFrom, material_costs 무변경', async () => {
    const before = await handle.db.select().from(materialCosts).orderBy(materialCosts.id);
    const error = await upsertMaterialCost(ctx(), {
      ...NEW_COST,
      effectiveFrom: before[0]!.effectiveFrom,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
    expect((error as AppError).fieldErrors?.effectiveFrom?.[0]).toContain('같은 적용시작일');
    expect(await handle.db.select().from(materialCosts).orderBy(materialCosts.id)).toEqual(before);
    expect(await auditByAction(handle, 'material_cost.create')).toHaveLength(0);
  });

  it('새 날짜면 manual 행(source_row NULL)으로 등록 → 계열 최신 재계산, 제품군 파생, 감사 material_cost.create', async () => {
    const result = await upsertMaterialCost(ctx(), NEW_COST);
    expect(result).toMatchObject({ operationStatus: '운영중' });
    const [created] = await handle.db
      .select()
      .from(materialCosts)
      .where(eq(materialCosts.id, result.id));
    expect(created).toMatchObject({
      source: 'manual',
      sourceRow: null,
      currency: 'KRW',
      unitCost: '1234567.00',
      productFamily: 'WAPPLES',
      isFinalSource: false,
      isLatestInSeries: true,
      effectiveTo: null,
    });
    const others = (await rowsOf('W10100016')).filter((row) => row.id !== result.id);
    expect(others.every((row) => !row.isLatestInSeries)).toBe(true);
    expect((await auditByAction(handle, 'material_cost.create')).at(-1)).toMatchObject({
      reason: '2027 계약',
      targetId: String(result.id),
    });
    expect(await queryCount(handle.db, COST_I2_VIOLATIONS_SQL)).toBe(0);
    await deleteMaterialCost(ctx(), { id: result.id, reason: '정리' });
  });

  it('필수값 누락은 ZodError(조사 포함), read 토큰은 차단', async () => {
    const error = await createMaterialCost(ctx(), {
      ...NEW_COST,
      materialCode: '',
      reason: '',
    }).catch((e: unknown) => e);
    expect(JSON.stringify(error)).toContain('자재번호를 입력하세요');
    const readOnly = costAccessForTests({ id: null, email: 'ro' }, 'read');
    await expect(createMaterialCost({ ...ctx(), access: readOnly }, NEW_COST)).rejects.toThrow(
      /write/,
    );
  });
});

describe('updateMaterialCost', () => {
  it('사유 없이 → 필드 오류(ZodError, 조사 "사유를")', async () => {
    const [row] = await rowsOf('W10100016');
    const error = await updateMaterialCost(ctx(), {
      id: row!.id,
      unitCost: '1',
      effectiveFrom: row!.effectiveFrom,
      reason: ' ',
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'ZodError' });
    expect(JSON.stringify(error)).toContain('변경 사유를 입력하세요');
  });

  it('ERP 행 수정 → manual, before/after 스냅샷 + 사유, 계열 재계산', async () => {
    const [older, newer] = await rowsOf('W10100016');
    // 이전 행의 적용시작일을 최신 행보다 뒤로 옮기면 최신이 바뀐다
    const result = await updateMaterialCost(ctx(), {
      id: older!.id,
      unitCost: '999000',
      effectiveFrom: '2026-06-01',
      remark: '',
      reason: '2026 계약 반영',
    });
    expect(result).toEqual({ id: older!.id, operationStatus: '운영중' });
    const [wasNewer] = await handle.db
      .select()
      .from(materialCosts)
      .where(eq(materialCosts.id, newer!.id));
    const [updated] = await handle.db
      .select()
      .from(materialCosts)
      .where(eq(materialCosts.id, older!.id));
    expect(updated).toMatchObject({
      source: 'manual',
      unitCost: '999000.00',
      remark: null,
      isLatestInSeries: true,
      importBatchId: null,
    });
    expect(wasNewer).toMatchObject({
      isLatestInSeries: false,
      operationStatus: '미사용',
      effectiveTo: '2026-06-01',
    });
    const [log] = await auditByAction(handle, 'material_cost.update');
    expect(log).toMatchObject({ reason: '2026 계약 반영', targetId: String(older!.id) });
    expect(log!.before).toMatchObject({
      source: 'erp',
      unitCost: '984000.00',
      effectiveFrom: '2024-01-01',
    });
    expect(Object.keys(log!.after ?? {})).toHaveLength(13);
    expect(await queryCount(handle.db, COST_I2_VIOLATIONS_SQL)).toBe(0);
  });

  it('같은 계열·적용시작일로 옮기면 CONFLICT (앱 검사 — UNIQUE 없이도 수동 중복 차단)', async () => {
    const [a, b] = await rowsOf('W10100016');
    const error = await updateMaterialCost(ctx(), {
      id: a!.id,
      unitCost: '1',
      effectiveFrom: b!.effectiveFrom,
      reason: 'x',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
  });

  it('ERP 가 들고 온 같은 날짜 중복 행은 날짜를 그대로 두면 값만 고칠 수 있다 (결정 B)', async () => {
    const [a] = await rowsOf('W20100001');
    const clone = Object.fromEntries(
      Object.entries(a!).filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key)),
    ) as typeof a;
    await handle.db.insert(materialCosts).values({ ...clone!, unitCost: '1.00' });
    await expect(
      updateMaterialCost(ctx(), {
        id: a!.id,
        unitCost: '2',
        effectiveFrom: a!.effectiveFrom,
        reason: '값만 수정',
      }),
    ).resolves.toMatchObject({ id: a!.id });
    await expect(queryCount(handle.db, COST_I2_VIOLATIONS_SQL)).resolves.toBe(0);
  });

  it('없는 행 NOT_FOUND, read 토큰으로 변경 시도는 차단', async () => {
    await expect(
      updateMaterialCost(ctx(), {
        id: 999_999,
        unitCost: '1',
        effectiveFrom: '2025-01-01',
        reason: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const readOnly = costAccessForTests({ id: null, email: 'ro' }, 'read');
    await expect(
      updateMaterialCost(
        { ...ctx(), access: readOnly },
        { id: 1, unitCost: '1', effectiveFrom: '2025-01-01', reason: 'x' },
      ),
    ).rejects.toThrow(/write/);
  });
});

describe('deleteMaterialCost', () => {
  it('soft delete + 사유 + 계열 재계산(이전 행이 다시 최신) + 감사', async () => {
    const rows = await rowsOf('W10100016');
    const latest = rows.find((row) => row.isLatestInSeries)!;
    const other = rows.find((row) => !row.isLatestInSeries)!;
    await expect(deleteMaterialCost(ctx(), { id: latest.id, reason: '' })).rejects.toMatchObject({
      name: 'ZodError',
    });
    await deleteMaterialCost(ctx(), { id: latest.id, reason: '잘못 등록' });
    const [deleted] = await handle.db
      .select()
      .from(materialCosts)
      .where(eq(materialCosts.id, latest.id));
    expect(deleted).toMatchObject({ isLatestInSeries: false, operationStatus: '미사용' });
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    const [restored] = await handle.db
      .select()
      .from(materialCosts)
      .where(eq(materialCosts.id, other.id));
    expect(restored).toMatchObject({
      isLatestInSeries: true,
      operationStatus: '운영중',
      effectiveTo: null,
    });
    expect((await auditByAction(handle, 'material_cost.delete')).at(-1)).toMatchObject({
      reason: '잘못 등록',
    });
    await expect(
      deleteMaterialCost(ctx(), { id: latest.id, reason: 'again' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
