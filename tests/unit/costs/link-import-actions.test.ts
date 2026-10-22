// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, costItemLinks, importBatches, items, materialCosts } from '@/db/schema';
import { AppError } from '@/lib/result';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 품목-원가 매칭 파일 Server Actions (erp-upload-guide §6.2-5·6) — 합성 데이터만.
 * `cost.write` 없으면(USER) 미리보기·확정 모두 FORBIDDEN + cost_link.import denied 1행 + 무변경.
 * 확정 중 confirmCostLinks 가 품목코드를 나열한 VALIDATION 을 내도 응답·로그에는 목록이 없고 CONFLICT(다시 미리보기).
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
  failConfirm: false,
  failScope: false,
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
// 미리보기와 확정 사이 경쟁(다른 관리자가 품목을 지움 등)을 흉내: confirmCostLinks 가 품목코드를 나열한 VALIDATION
vi.mock('@/server/cost/item-links', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/cost/item-links')>();
  return {
    ...original,
    scopeOf: async (...args: Parameters<typeof original.scopeOf>) => {
      if (state.failScope) {
        // drizzle 오류처럼 메시지에 바인딩 값이 섞인 예상 밖 오류
        throw Object.assign(new Error('Failed query: select ... params: TEST-ITEM-001'), {
          code: '57014',
        });
      }
      return original.scopeOf(...args);
    },
    confirmCostLinks: async (...args: Parameters<typeof original.confirmCostLinks>) => {
      if (state.failConfirm) {
        throw new AppError('VALIDATION', '품목 마스터에 없는 품목입니다: TEST-ITEM-001');
      }
      return original.confirmCostLinks(...args);
    },
  };
});

const actions = await import('@/features/costs/link-actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;
const PAIRS = [{ itemCode: 'TEST-ITEM-001', materialCode: 'TEST-MAT-001' }];
const APPLY = { pairs: PAIRS, expected: { changed: 0, added: 1 } };
const links = () => state.handle!.db.select().from(costItemLinks);

let logs: string[];

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  const [batch] = await state.handle.db
    .insert(importBatches)
    .values({ kind: 'item_master', fileName: 'synthetic.xlsx', fileSha256: 's', fileSize: 1 })
    .returning({ id: importBatches.id });
  await state.handle.db.insert(items).values({
    itemCode: 'TEST-ITEM-001',
    itemName: 'TEST 품목 1',
    categoryMajor: 'WAPPLES',
    categoryMid: 'H/W Appliance',
    categoryMinor: 'Wapples',
    itemKind: '본품',
    itemStatus: '사용',
    importBatchId: batch!.id,
  });
  await state.handle.db.insert(materialCosts).values({
    materialCode: 'TEST-MAT-001',
    materialName: 'TEST 자재 1',
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

beforeEach(async () => {
  invalidateSessionUser();
  state.failConfirm = false;
  state.failScope = false;
  await state.handle!.db.delete(costItemLinks);
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('USER(cost.write 없음) 거부', () => {
  it.each([
    ['previewCostLinkImport', () => actions.previewCostLinkImportAction({ pairs: PAIRS })],
    ['applyCostLinkImport', () => actions.applyCostLinkImportAction(APPLY)],
  ])('%s: FORBIDDEN + 매핑 무변경 + cost_link.import denied 1행', async (_name, call) => {
    state.sessionUserId = userId;
    const audits = await state.handle!.db.$count(auditLogs);
    expect(await call()).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
    });
    expect(await links()).toEqual([]);
    expect(await state.handle!.db.$count(auditLogs)).toBe(audits + 1);
    const denied = (await auditByAction(state.handle!, 'cost_link.import')).at(-1)!;
    expect(denied).toMatchObject({ actorUserId: userId, result: 'denied' });
    expect(JSON.stringify(denied)).not.toMatch(/TEST-ITEM|TEST-MAT/);
  });
});

describe('ADMIN', () => {
  it('미리보기 → 확정: 추가 1건, 요약 감사 actor = 관리자·건수만, 로그에 목록 없음', async () => {
    state.sessionUserId = adminId;
    const preview = await actions.previewCostLinkImportAction({ pairs: PAIRS });
    expect(preview).toMatchObject({ ok: true, data: { added: [{ itemCode: 'TEST-ITEM-001' }] } });
    expect(await actions.applyCostLinkImportAction(APPLY)).toMatchObject({
      ok: true,
      data: { saved: 1, unchanged: 0 },
    });
    expect((await links()).map((row) => [row.itemCode, row.materialCode])).toEqual([
      ['TEST-ITEM-001', 'TEST-MAT-001'],
    ]);
    const summary = (await auditByAction(state.handle!, 'cost_link.import')).at(-1)!;
    expect(summary).toMatchObject({ actorUserId: adminId, result: 'success' });
    expect(Object.keys(summary.after as object).sort()).toEqual([
      'failedByReason',
      'saved',
      'unchanged',
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/TEST-ITEM|TEST-MAT/);
    expect(logs.join('\n')).not.toMatch(/TEST-ITEM|TEST-MAT/);
  });

  it('확정 중 confirmCostLinks VALIDATION(품목코드 나열) → CONFLICT stale, 응답·로그에 코드 없음', async () => {
    state.sessionUserId = adminId;
    state.failConfirm = true;
    const result = await actions.applyCostLinkImportAction(APPLY);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', details: { stale: true } },
    });
    expect(JSON.stringify(result)).not.toMatch(/TEST-ITEM|TEST-MAT/);
    expect(logs.join('\n')).toMatch(/cost_link\.import\.rejected/);
    expect(logs.join('\n')).not.toMatch(/TEST-ITEM|TEST-MAT/);
    expect(await links()).toEqual([]);
  });

  it('예상 밖 DB 오류 → INTERNAL, 로그에는 이벤트·코드·건수만(바인딩 값 없음)', async () => {
    state.sessionUserId = adminId;
    state.failScope = true;
    const result = await actions.previewCostLinkImportAction({ pairs: PAIRS });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(logs.join('\n')).toMatch(/cost_link\.import\.preview_failed/);
    expect(logs.join('\n')).toMatch(/57014/);
    expect(logs.join('\n')).not.toMatch(/TEST-ITEM|TEST-MAT/);
  });
});
