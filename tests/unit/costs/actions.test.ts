// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, importBatches, materialCosts } from '@/db/schema';
import { costAccessForTests } from '@/server/cost/access-token';
import { applyCostImport } from '@/server/cost/apply-costs';

import { TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 원가 Server Actions — AC-41 §4.7.1 거부 판정(USER: FORBIDDEN 봉투·원가 값 미반환·DB 무변경·감사 cost.read denied 1행),
 * ADMIN 성공 경로, 순매출 계산기 원가 잠금(§4.5.5).
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const actions = await import('@/features/costs/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;
let batchId: string;
let rowId: number;

const COST_KEYS = /unit_cost|unitCost|material_code|materialCode/;

async function snapshot() {
  const db = state.handle!.db;
  return {
    costs: await db.select().from(materialCosts).orderBy(materialCosts.id),
    batches: await db.select().from(importBatches).orderBy(importBatches.createdAt),
    audits: await db.$count(auditLogs),
  };
}

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  batchId = (await uploadFixture(state.handle, 'costs', 'costs-sample.xlsx')).batchId;
  await applyCostImport(
    {
      handle: state.handle,
      access: costAccessForTests({ id: adminId, email: 'admin@pentasecurity.com' }),
      meta: TEST_META,
    },
    { batchId, reused: false },
  );
  rowId = (await state.handle.db.select().from(materialCosts).limit(1))[0]!.id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
});

describe('AC-41 USER 거부 (§4.7.1)', () => {
  it('getCostRows: FORBIDDEN 봉투, 원가 키 없음, DB 무변경, 감사 cost.read denied 1행', async () => {
    state.sessionUserId = userId;
    const before = await snapshot();
    const result = await actions.getCostRowsAction({});
    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
    });
    expect(JSON.stringify(result)).not.toMatch(COST_KEYS);
    const after = await snapshot();
    expect(after.costs).toEqual(before.costs);
    expect(after.batches).toEqual(before.batches);
    expect(after.audits).toBe(before.audits + 1);
    expect((await auditByAction(state.handle!, 'cost.read')).at(-1)).toMatchObject({
      actorUserId: userId,
      result: 'denied',
      targetId: 'action:getCostRows',
    });
  });

  it.each([
    [
      'applyCostImport',
      'cost_import.apply',
      () => actions.applyCostImportAction({ batchId, reused: true }),
    ],
    [
      'updateMaterialCost',
      'material_cost.update',
      () =>
        actions.updateMaterialCostAction({
          id: rowId,
          unitCost: '1',
          effectiveFrom: '2025-01-01',
          reason: 'x',
        }),
    ],
    [
      'deleteMaterialCost',
      'material_cost.delete',
      () => actions.deleteMaterialCostAction({ id: rowId, reason: 'x' }),
    ],
  ])('%s: FORBIDDEN + 무변경 + %s denied 1행', async (_name, auditKey, call) => {
    state.sessionUserId = userId;
    const before = await snapshot();
    const result = await call();
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(JSON.stringify(result)).not.toMatch(COST_KEYS);
    const after = await snapshot();
    expect(after.costs).toEqual(before.costs);
    expect(after.audits).toBe(before.audits + 1);
    expect((await auditByAction(state.handle!, auditKey)).at(-1)).toMatchObject({
      actorUserId: userId,
      result: 'denied',
    });
  });

  it('비로그인은 UNAUTHENTICATED', async () => {
    state.sessionUserId = undefined;
    expect(await actions.getCostRowsAction({})).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});

describe('ADMIN', () => {
  it('조회·적용(재사용)·수정·삭제 봉투', async () => {
    state.sessionUserId = adminId;
    const page = await actions.getCostRowsAction({ family: 'WAPPLES' });
    expect(page).toMatchObject({ ok: true, data: { total: 2 } });
    expect(JSON.stringify(page)).toMatch(COST_KEYS);
    expect(await actions.applyCostImportAction({ batchId, reused: true })).toMatchObject({
      ok: true,
      data: { inserted: 3 },
    });
    // 재적용은 ERP 행을 지우고 다시 넣으므로 id 가 바뀐다
    const row = (
      await state.handle!.db.select().from(materialCosts).orderBy(materialCosts.id).limit(1)
    )[0]!;
    rowId = row.id;
    const invalid = await actions.updateMaterialCostAction({
      id: rowId,
      unitCost: 'abc',
      effectiveFrom: '2025-01-01',
      reason: '',
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    if (invalid.ok) throw new Error('unreachable');
    expect(invalid.error.fieldErrors?.reason?.[0]).toBe('변경 사유를 입력하세요');
    expect(
      await actions.updateMaterialCostAction({
        id: rowId,
        unitCost: '1000',
        effectiveFrom: row.effectiveFrom,
        reason: '테스트',
      }),
    ).toMatchObject({ ok: true });
    expect(await actions.deleteMaterialCostAction({ id: rowId, reason: '정리' })).toEqual({
      ok: true,
      data: { id: rowId },
    });
  });
});

describe('순매출 계산기 원가 잠금 (§4.5.5)', () => {
  it('USER: unitCost 를 보내도 무시 — cost 키 없음, costLocked=true', async () => {
    state.sessionUserId = userId;
    const result = await actions.calculateNetSalesAction({
      sellingPrice: 1000,
      quantity: 2,
      unitCost: 500,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        grossAmount: '2000.00',
        discountAmount: '0.00',
        netAmount: '2000.00',
        costLocked: true,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /cost|profit|margin/i.source.replace('cost', 'totalCost'),
    );
  });

  it('ADMIN: 원가·이익·이익률 반환, costLocked=false; 잘못된 입력은 VALIDATION', async () => {
    state.sessionUserId = adminId;
    const result = await actions.calculateNetSalesAction({
      sellingPrice: 1000,
      quantity: 2,
      discountRate: 10,
      unitCost: 500,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        netAmount: '1800.00',
        costLocked: false,
        cost: { totalCost: '1000.00', profit: '800.00', marginRate: '44.4' },
      },
    });
    expect(await actions.calculateNetSalesAction({ sellingPrice: -1, quantity: 1 })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });
});
