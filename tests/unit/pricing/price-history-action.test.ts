// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { items, salesPrices } from '@/db/schema';
import { applyPolicy } from '@/server/imports/apply-policy';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * getPriceHistoryAction (price-change-history-modal §2.1-4): pricing.read(USER·ADMIN), 입력 = 양의 정수 id 만,
 * 품목 마스터 ERP 비고는 ADMIN 응답 요약에만(USER 응답에 키 없음), 행별 비고(remark)는 모든 역할,
 * 원가 키 없음, 삭제·없는 id → NOT_FOUND.
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
let deletedId: number;

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
  const rows = await state.handle.db.select().from(salesPrices).orderBy(salesPrices.id).limit(2);
  rowId = rows[0]!.id;
  deletedId = rows[1]!.id;
  await state.handle.db
    .update(salesPrices)
    .set({ deletedAt: new Date() })
    .where(eq(salesPrices.id, deletedId));
  // ERP 비고가 있는 품목 마스터 (stub 이 있으면 raw 만 갱신)
  await state.handle.db
    .update(items)
    .set({ raw: { 비고: '담당자 메모' } })
    .where(eq(items.itemCode, rows[0]!.itemCode));
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
});

/** 응답 전체의 키 (중첩 포함) */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => keysOf(entry, out));
  else if (value && typeof value === 'object')
    for (const [key, entry] of Object.entries(value)) {
      out.add(key);
      keysOf(entry, out);
    }
  return out;
}

describe('getPriceHistoryAction', () => {
  it('USER: 조회 가능, erpRemark 키 없음, 원가 키 없음', async () => {
    state.sessionUserId = userId;
    const result = await actions.getPriceHistoryAction(rowId);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.currentId).toBe(rowId);
    expect(result.data.rows.some((row) => row.id === rowId)).toBe(true);
    const keys = [...keysOf(result.data)];
    expect(keys).not.toContain('erpRemark');
    expect(JSON.stringify(result.data)).not.toContain('담당자 메모');
    for (const row of result.data.rows) expect(Object.hasOwn(row, 'remark')).toBe(true);
    expect(keys.filter((key) => /cost|margin|material/i.test(key))).toEqual([]);
  });

  it('ADMIN: 요약에 품목 마스터 비고 한 번, 행에는 행별 비고만', async () => {
    state.sessionUserId = adminId;
    const result = await actions.getPriceHistoryAction(rowId);
    if (!result.ok) throw new Error(result.error.message);
    for (const row of result.data.rows) {
      expect(Object.hasOwn(row, 'erpRemark')).toBe(false);
      expect(Object.hasOwn(row, 'remark')).toBe(true);
    }
    const hasMaster = (
      await state
        .handle!.db.select()
        .from(items)
        .where(eq(items.itemCode, result.data.series.itemCode))
    ).length;
    expect(hasMaster).toBe(1);
    expect(result.data.series.erpRemark).toBe('담당자 메모');
    expect([...keysOf(result.data)].filter((key) => /cost/i.test(key))).toEqual([]);
  });

  it('삭제된 id·없는 id → NOT_FOUND', async () => {
    state.sessionUserId = userId;
    for (const id of [deletedId, 999_999])
      expect(await actions.getPriceHistoryAction(id)).toEqual({
        ok: false,
        error: { code: 'NOT_FOUND', message: '삭제되었거나 찾을 수 없는 가격입니다.' },
      });
  });

  it('입력 검증: 양의 정수 id 만 (계열 키 문자열·0·음수·소수 → VALIDATION)', async () => {
    state.sessionUserId = userId;
    const [row] = await state
      .handle!.db.select({ seriesKey: salesPrices.seriesKey })
      .from(salesPrices)
      .where(eq(salesPrices.id, rowId));
    for (const bad of [row!.seriesKey, 0, -1, 1.5, 'abc'] as unknown as number[])
      expect(await actions.getPriceHistoryAction(bad)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
  });

  it('로그인 없음 → 거부(UNAUTHENTICATED), 데이터 없음', async () => {
    state.sessionUserId = undefined;
    const result = await actions.getPriceHistoryAction(rowId);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(JSON.stringify(result)).not.toMatch(/rows|series/);
  });
});
