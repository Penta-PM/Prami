// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, quotes } from '@/db/schema';
import { applyPolicy } from '@/server/imports/apply-policy';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 견적 Server Actions — USER 도 저장·목록·삭제 가능(calculator.use)하지만 남의 견적 삭제는 FORBIDDEN·무변경·감사,
 * 비로그인은 UNAUTHENTICATED. 후보 조회 응답에 원가 키 없음 (AC-43).
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

const actions = await import('@/features/calculator/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let userId: string;
let otherId: string;
let adminId: string;
const COST_KEYS = /unit_cost|unitCost|material_code|materialCode|material_costs/;
const LINE = {
  kind: 'item' as const,
  itemCode: 'P1',
  name: 'Wapples-500',
  priceType: '정상판매',
  qty: 1,
  unitPrice: 1_000_000,
  currency: 'KRW',
  parts: [],
  bundles: [],
  groupItems: [],
  discountRate: 0,
};

beforeAll(async () => {
  state.handle = await createTestDb();
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  otherId = (await insertUser(state.handle, { email: 'other@pentasecurity.com', role: 'USER' })).id;
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  const sales = await uploadFixture(state.handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle: state.handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
});

describe('후보 조회', () => {
  it('USER 가 단가유형별 품목·옵션을 조회하고 응답에 원가 키가 없다', async () => {
    state.sessionUserId = userId;
    const items = await actions.listQuoteItemsAction({ family: 'WAPPLES', priceType: '정상판매' });
    expect(items).toMatchObject({ ok: true });
    if (!items.ok) throw new Error('unreachable');
    expect(items.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(items)).not.toMatch(COST_KEYS);
    const options = await actions.listQuoteOptionsAction({
      family: 'WAPPLES',
      priceType: '정상판매',
      modelItemCode: items.data[0]!.itemCode,
    });
    expect(options).toMatchObject({ ok: true, data: { mapped: false, bundles: [] } });
    expect(JSON.stringify(options)).not.toMatch(COST_KEYS);
    expect(await actions.listQuoteCategoriesAction({ family: 'WAPPLES' })).toMatchObject({
      ok: true,
      data: { hasMaster: false, majors: ['WAPPLES'] },
    });
  });

  it('비로그인은 UNAUTHENTICATED', async () => {
    state.sessionUserId = undefined;
    expect(await actions.listMyQuotesAction()).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});

describe('저장·목록·삭제 (AC-63)', () => {
  it('USER 저장 → 목록에 본인 것만, 다른 USER 목록에는 없음, ADMIN 은 전체', async () => {
    state.sessionUserId = userId;
    const saved = await actions.saveQuoteAction({ productFamily: 'WAPPLES', lines: [LINE] });
    expect(saved).toMatchObject({
      ok: true,
      data: { quoteNo: expect.stringMatching(/^Q-\d{4}-0001$/) as string },
    });
    const mine = await actions.listMyQuotesAction();
    expect(mine).toMatchObject({ ok: true });
    if (!mine.ok) throw new Error('unreachable');
    expect(mine.data.map((quote) => quote.ownerUserId)).toEqual([userId]);

    state.sessionUserId = otherId;
    expect(await actions.listMyQuotesAction()).toMatchObject({ ok: true, data: [] });
    state.sessionUserId = adminId;
    const all = await actions.listMyQuotesAction();
    if (!all.ok) throw new Error('unreachable');
    expect(all.data).toHaveLength(1);
  });

  it('§4.7.1: 다른 사용자의 견적 삭제 → FORBIDDEN 봉투 + quotes 무변경 + 감사 quote.delete denied', async () => {
    state.sessionUserId = userId;
    const mine = await actions.listMyQuotesAction();
    if (!mine.ok) throw new Error('unreachable');
    const id = mine.data[0]!.id;

    state.sessionUserId = otherId;
    invalidateSessionUser();
    const before = await state.handle!.db.select().from(quotes);
    const audits = await state.handle!.db.$count(auditLogs);
    const result = await actions.deleteQuoteAction({ id });
    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '다른 사용자의 견적입니다' },
    });
    expect(await state.handle!.db.select().from(quotes)).toEqual(before);
    expect(await state.handle!.db.$count(auditLogs)).toBe(audits + 1);
    expect((await auditByAction(state.handle!, 'quote.delete')).at(-1)).toMatchObject({
      actorUserId: otherId,
      result: 'denied',
    });

    state.sessionUserId = userId;
    invalidateSessionUser();
    expect(await actions.deleteQuoteAction({ id })).toMatchObject({ ok: true, data: { id } });
    expect(await actions.saveQuoteAction({ productFamily: 'WAPPLES', lines: [] })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });
});
