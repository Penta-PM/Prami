// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, costItemLinks, importBatches, items, materialCosts } from '@/db/schema';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 원가 매핑 Server Actions (스펙 cost-ratio-price-change §4 매핑 화면): `cost.write` 없으면(USER) FORBIDDEN 봉투 +
 * 매핑 무변경 + 감사 denied 1행, ADMIN 은 확정·해제 성공(응답은 건수만).
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

const actions = await import('@/features/costs/link-actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;
const PAIR = { itemCode: 'P1', materialCode: 'W1' };

const links = () => state.handle!.db.select().from(costItemLinks).orderBy(costItemLinks.itemCode);

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  const [batch] = await state.handle.db
    .insert(importBatches)
    .values({ kind: 'item_master', fileName: 'a.xlsx', fileSha256: 'a', fileSize: 1 })
    .returning({ id: importBatches.id });
  await state.handle.db.insert(items).values({
    itemCode: 'P1',
    itemName: 'Wapples-1700 T2 (H1700 T2)',
    categoryMajor: 'WAPPLES',
    categoryMid: 'H/W Appliance',
    categoryMinor: 'Wapples',
    itemKind: '본품',
    itemStatus: '사용',
    importBatchId: batch!.id,
  });
  await state.handle.db.insert(materialCosts).values({
    materialCode: 'W1',
    materialName: 'WAPPLES-1700 T2',
    unit: 'EA',
    priceType: '표준구매원가',
    priceCategory: '일반',
    currency: 'KRW',
    unitCost: '1.00',
    effectiveFrom: '2026-01-01',
    isFinalSource: true,
    appliesToAllCustomers: true,
    source: 'erp',
  });
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
});

describe('USER 거부', () => {
  it.each([
    [
      'confirmCostLinks',
      'cost_link.upsert',
      () => actions.confirmCostLinksAction({ links: [PAIR] }),
    ],
    ['deleteCostLink', 'cost_link.delete', () => actions.deleteCostLinkAction({ itemCode: 'P1' })],
  ])('%s: FORBIDDEN + 매핑 무변경 + %s denied 1행', async (_name, auditKey, call) => {
    state.sessionUserId = userId;
    const before = await links();
    const audits = await state.handle!.db.$count(auditLogs);
    const result = await call();
    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
    });
    expect(await links()).toEqual(before);
    expect(await state.handle!.db.$count(auditLogs)).toBe(audits + 1);
    expect((await auditByAction(state.handle!, auditKey)).at(-1)).toMatchObject({
      actorUserId: userId,
      result: 'denied',
    });
  });
});

describe('ADMIN', () => {
  it('확정 → 해제: 건수만 응답, 감사 actor = 관리자', async () => {
    state.sessionUserId = adminId;
    expect(await actions.confirmCostLinksAction({ links: [PAIR] })).toEqual({
      ok: true,
      data: { saved: 1, unchanged: 0 },
    });
    expect((await links()).map((row) => [row.itemCode, row.materialCode, row.createdBy])).toEqual([
      ['P1', 'W1', adminId],
    ]);
    expect((await auditByAction(state.handle!, 'cost_link.upsert')).at(-1)).toMatchObject({
      actorUserId: adminId,
      result: 'success',
    });
    expect(await actions.deleteCostLinkAction({ itemCode: 'P1' })).toEqual({
      ok: true,
      data: { deleted: true },
    });
    expect(await links()).toEqual([]);
  });

  it('검증 실패는 VALIDATION 봉투', async () => {
    state.sessionUserId = adminId;
    const result = await actions.confirmCostLinksAction({
      links: [{ itemCode: 'NOPE', materialCode: 'W1' }],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
