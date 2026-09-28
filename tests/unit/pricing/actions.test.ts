// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, salesPrices } from '@/db/schema';
import { applyPolicy } from '@/server/imports/apply-policy';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 가격정책 Server Actions — ADMIN 성공 경로 + §4.7.1 거부 판정(USER: FORBIDDEN·무변경·denied 1행·부수효과 없음).
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

const actions = await import('@/features/pricing/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;
let rowId: number;

const snapshot = async () => ({
  prices: await state.handle!.db.select().from(salesPrices).orderBy(salesPrices.id),
  audits: await state.handle!.db.$count(auditLogs),
});

const policy = {
  productFamily: 'WAPPLES',
  itemCode: 'P-NEW-0001',
  itemName: '신규 모델',
  unit: 'EA',
  priceType: '정상판매',
  priceCategory: '일반',
  currency: 'KRW',
  unitPrice: '1000000',
  effectiveFrom: '2027-01-01',
  reason: '테스트 등록',
};

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  const salesBatchId = (await uploadFixture(state.handle, 'sales', 'sales-200.xlsx')).batchId;
  await applyPolicy(
    { handle: state.handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
  const [row] = await state.handle.db.select().from(salesPrices).limit(1);
  rowId = row!.id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
});

describe('USER 는 조회 가능, 쓰기는 §4.7.1 거부', () => {
  it('행 상세 조회는 USER 도 가능', async () => {
    state.sessionUserId = userId;
    const result = await actions.getPriceRowDetailAction(rowId);
    expect(result).toMatchObject({ ok: true, data: { row: { id: rowId } } });
    expect(await actions.getPriceRowDetailAction(999_999)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it.each([
    ['create', 'price_policy.create', () => actions.createPricePolicyAction(policy)],
    [
      'update',
      'price_policy.update',
      () => actions.updatePricePolicyAction({ ...policy, id: rowId }),
    ],
    [
      'delete',
      'price_policy.delete',
      () => actions.deletePricePolicyAction({ id: rowId, reason: 'x' }),
    ],
    ['lookup', 'price_policy.lookup', () => actions.lookupItemAction('P2002030005')],
  ])(
    '%s: ① FORBIDDEN ② sales_prices 무변경 ③ %s denied 1행 ④ 부수효과 없음',
    async (_name, auditKey, call) => {
      state.sessionUserId = userId;
      const before = await snapshot();
      const result = await call();
      expect(result).toEqual({
        ok: false,
        error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
      });
      const after = await snapshot();
      expect(after.prices).toEqual(before.prices);
      expect(after.audits).toBe(before.audits + 1);
      const denied = await auditByAction(state.handle!, auditKey);
      expect(denied.at(-1)).toMatchObject({ actorUserId: userId, result: 'denied' });
    },
  );
});

describe('ADMIN 쓰기', () => {
  it('등록 → 수정 → 삭제 봉투, 검증 오류는 VALIDATION + fieldErrors', async () => {
    state.sessionUserId = adminId;
    const invalid = await actions.createPricePolicyAction({ ...policy, reason: '' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    if (invalid.ok) throw new Error('unreachable');
    expect(invalid.error.fieldErrors?.reason).toBeDefined();

    const created = await actions.createPricePolicyAction(policy);
    expect(created).toMatchObject({
      ok: true,
      data: { operationStatus: '운영중', discarded: false },
    });
    if (!created.ok) throw new Error('unreachable');
    const updated = await actions.updatePricePolicyAction({
      ...policy,
      unitPrice: '1100000',
      id: created.data.id,
    });
    expect(updated).toMatchObject({ ok: true });
    expect(await actions.deletePricePolicyAction({ id: created.data.id, reason: '정리' })).toEqual({
      ok: true,
      data: { id: created.data.id },
    });
    expect(await actions.lookupItemAction('P2002030005')).toMatchObject({
      ok: true,
      data: { itemCode: 'P2002030005' },
    });
  });
});
