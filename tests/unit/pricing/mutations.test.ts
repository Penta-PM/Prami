// @vitest-environment node
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { items, salesPrices } from '@/db/schema';
import { AppError } from '@/lib/result';
import { applyPolicy } from '@/server/imports/apply-policy';
import { checkInvariants } from '@/server/imports/invariants';
import {
  createPricePolicy,
  deletePricePolicy,
  lookupItem,
  updatePricePolicy,
} from '@/server/pricing/mutations';
import type { PolicyInput } from '@/server/pricing/schemas';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb } from '../../helpers/pglite';

/** 등록·수정·삭제 (§4.5.3) — AC-16(사유·manual·재계산·감사 20컬럼), AC-23(폐기 품목 = 미사용) */
let handle: DbHandle;
/** 첫 등록 테스트가 대상으로 삼은 ERP 최신 행 (이후 중복·삭제 테스트가 같은 계열을 쓴다) */
let base: typeof salesPrices.$inferSelect;
const ctx = () => ({ handle, actor: TEST_ACTOR, meta: TEST_META });

async function latestErp() {
  const [row] = await handle.db
    .select()
    .from(salesPrices)
    .where(
      and(
        eq(salesPrices.isLatestInSeries, true),
        eq(salesPrices.source, 'erp'),
        sql`${salesPrices.itemCode} = 'P2002030005'`,
      ),
    )
    .limit(1);
  if (!row) throw new Error('fixture');
  return row;
}

function inputFrom(
  row: typeof salesPrices.$inferSelect,
  overrides: Partial<PolicyInput> = {},
): PolicyInput {
  return {
    productFamily: row.productFamily,
    itemCode: row.itemCode,
    itemName: row.itemName,
    unit: row.unit,
    priceType: row.priceType,
    priceCategory: row.priceCategory,
    currency: row.currency,
    unitPrice: '9900000',
    effectiveFrom: '2027-01-01',
    customerCode: row.customerCode,
    reason: '2027년 정가 정책 반영',
    ...overrides,
  };
}

const expectCode = async (promise: Promise<unknown>, code: AppError['code']) => {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
};

beforeAll(async () => {
  handle = await createTestDb();
  const salesBatchId = (await uploadFixture(handle, 'sales', 'sales-200.xlsx')).batchId;
  const itemBatchId = (await uploadFixture(handle, 'items', 'items-v1.xlsx')).batchId;
  await applyPolicy(ctx(), { salesBatchId, itemBatchId, salesReused: false, itemReused: false });
});

afterAll(async () => {
  await handle.close();
});

describe('등록 (AC-16)', () => {
  it('변경 사유 없이 저장 → 필드 오류', async () => {
    const base = await latestErp();
    await expect(createPricePolicy(ctx(), inputFrom(base, { reason: '  ' }))).rejects.toMatchObject(
      {
        name: 'ZodError',
      },
    );
  });

  it('사유 포함 저장 → manual 행, 이전 최신 행은 미사용, 감사 price_policy.create(after 20컬럼 + 사유)', async () => {
    base = await latestErp();
    const result = await createPricePolicy(ctx(), inputFrom(base));
    expect(result).toMatchObject({ operationStatus: '운영중', discarded: false });

    const [created] = await handle.db
      .select()
      .from(salesPrices)
      .where(eq(salesPrices.id, result.id));
    expect(created).toMatchObject({
      source: 'manual',
      isLatestInSeries: true,
      unitPrice: '9900000.00',
      sourceId: 0,
    });
    const [previous] = await handle.db
      .select()
      .from(salesPrices)
      .where(eq(salesPrices.id, base.id));
    expect(previous).toMatchObject({
      isLatestInSeries: false,
      operationStatus: '미사용',
      effectiveTo: '2027-01-01',
    });

    const [log] = await auditByAction(handle, 'price_policy.create');
    expect(log).toMatchObject({ reason: '2027년 정가 정책 반영', targetId: String(result.id) });
    expect(Object.keys(log!.after ?? {})).toEqual(
      expect.arrayContaining([
        'sourceId',
        'productFamily',
        'itemCode',
        'unitPrice',
        'effectiveFrom',
        'customerName',
        'source',
      ]),
    );
    expect(Object.keys(log!.after ?? {}).length).toBeGreaterThanOrEqual(21);
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });
  });

  it('같은 계열·적용시작일 중복 → CONFLICT', async () => {
    await expectCode(createPricePolicy(ctx(), inputFrom(base)), 'CONFLICT');
  });

  it('AC-23: 폐기 품목에 등록해도 미사용 + discarded 안내, I-1 = 0', async () => {
    const [discarded] = await handle.db
      .select()
      .from(items)
      .where(eq(items.itemStatus, '폐기'))
      .limit(1);
    const [row] = await handle.db
      .select()
      .from(salesPrices)
      .where(eq(salesPrices.itemCode, discarded!.itemCode))
      .limit(1);
    const result = await createPricePolicy(ctx(), inputFrom(row!, { effectiveFrom: '2030-01-01' }));
    expect(result).toMatchObject({ operationStatus: '미사용', discarded: true });
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });
    expect((await lookupItem(handle, discarded!.itemCode))?.itemStatus).toBe('폐기');
  });
});

describe('수정·삭제', () => {
  it('ERP 행 수정 → source=manual, before 에 원본 스냅샷, 계열 이동 시 양쪽 재계산', async () => {
    const [erp] = await handle.db
      .select()
      .from(salesPrices)
      .where(and(eq(salesPrices.source, 'erp'), eq(salesPrices.isLatestInSeries, false)))
      .limit(1);
    const result = await updatePricePolicy(ctx(), {
      ...inputFrom(erp!, {
        unitPrice: '1234',
        effectiveFrom: erp!.effectiveFrom,
        priceType: '테스트유형',
      }),
      id: erp!.id,
    });
    const [updated] = await handle.db
      .select()
      .from(salesPrices)
      .where(eq(salesPrices.id, result.id));
    expect(updated).toMatchObject({
      source: 'manual',
      priceType: '테스트유형',
      isLatestInSeries: true,
    });
    const [log] = await auditByAction(handle, 'price_policy.update');
    expect(log?.before).toMatchObject({
      source: 'erp',
      unitPrice: erp!.unitPrice,
      priceType: erp!.priceType,
    });
    expect(log?.after).toMatchObject({ source: 'manual', unitPrice: '1234.00' });
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });
  });

  it('삭제 → soft delete, 사유 필수, 이전 행이 다시 최신, 감사 price_policy.delete', async () => {
    const [manual] = await handle.db
      .select()
      .from(salesPrices)
      .where(and(eq(salesPrices.seriesKey, base.seriesKey), eq(salesPrices.source, 'manual')));
    await expect(deletePricePolicy(ctx(), { id: manual!.id, reason: '' })).rejects.toMatchObject({
      name: 'ZodError',
    });
    await deletePricePolicy(ctx(), { id: manual!.id, reason: '잘못 등록' });
    const [deleted] = await handle.db
      .select()
      .from(salesPrices)
      .where(eq(salesPrices.id, manual!.id));
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(deleted).toMatchObject({ isLatestInSeries: false, operationStatus: '미사용' });
    const [restored] = await handle.db
      .select()
      .from(salesPrices)
      .where(eq(salesPrices.id, base.id));
    expect(restored).toMatchObject({ isLatestInSeries: true, effectiveTo: null });
    const [log] = await auditByAction(handle, 'price_policy.delete');
    expect(log).toMatchObject({ reason: '잘못 등록', targetId: String(manual!.id) });
    await expectCode(deletePricePolicy(ctx(), { id: manual!.id, reason: '다시' }), 'NOT_FOUND');
    expect(await checkInvariants(handle.db)).toEqual({ i1: 0, i2: 0 });
  });

  it('품번 조회: 판매단가 품번은 제품군·단위까지, 없는 품번은 null', async () => {
    expect(await lookupItem(handle, 'P2002030005')).toMatchObject({
      productFamily: expect.any(String),
      unit: expect.any(String),
    });
    expect(await lookupItem(handle, 'NOPE')).toBeNull();
    expect(await lookupItem(handle, ' ')).toBeNull();
  });
});
