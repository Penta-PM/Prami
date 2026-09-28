// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import {
  auditLogs,
  importBatches,
  items,
  policyApplyRuns,
  salesPrices,
  stgSalesPrices,
} from '@/db/schema';

import {
  fixtureBytes,
  TEST_ACTOR,
  TEST_META,
  uploadFixture,
  XLSX_MIME,
} from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * §4.7.1 권한 거부 판정 (r3) — AC-04 의 PR-3 범위: applyPolicy Action, POST /api/imports/* Route.
 * USER 세션으로 직접 호출해 ① 봉투(Action)·HTTP 403(Route) ② 대상 테이블 무변경 ③ 감사 denied 1행(actor=USER)
 * ④ 부수효과 없음(배치·run 미생성)을 모두 단언한다.
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

const { POST } = await import('@/app/api/imports/[kind]/route');
const { applyPolicyAction } = await import('@/features/admin-policies/actions');
const { applyPolicy } = await import('@/server/imports/apply-policy');

let userId: string;
let salesBatchId: string;
let itemBatchId: string;

/** 판정 대상 테이블 전체 스냅샷 (행 수 + 값) */
async function snapshot() {
  const db = state.handle!.db;
  return {
    salesPrices: await db.select().from(salesPrices).orderBy(salesPrices.id),
    items: await db.select().from(items).orderBy(items.itemCode),
    runs: await db.select().from(policyApplyRuns).orderBy(policyApplyRuns.startedAt),
    batches: await db.select().from(importBatches).orderBy(importBatches.createdAt),
    staged: await db.$count(stgSalesPrices),
  };
}

beforeAll(async () => {
  state.handle = await createTestDb();
  await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' });
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  // 비어 있지 않은 상태에서 판정한다: ADMIN 경로로 업로드·적용 1회
  salesBatchId = (await uploadFixture(state.handle, 'sales', 'sales-200.xlsx')).batchId;
  itemBatchId = (await uploadFixture(state.handle, 'items', 'items-v1.xlsx')).batchId;
  await applyPolicy(
    { handle: state.handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId, itemBatchId, salesReused: false, itemReused: false },
  );
  state.sessionUserId = userId;
});

afterAll(async () => {
  await state.handle?.close();
});

describe('§4.7.1 Server Action — applyPolicy (USER)', () => {
  it('① FORBIDDEN 봉투(data 없음) ② 4개 테이블 무변경 ③ policy.apply denied 1행 ④ run 미생성', async () => {
    const before = await snapshot();
    const deniedBefore = await auditByAction(state.handle!, 'policy.apply');

    const result = await applyPolicyAction({
      salesBatchId,
      itemBatchId,
      salesReused: true,
      itemReused: true,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
    });
    expect('data' in result).toBe(false);
    expect(await snapshot()).toEqual(before);
    const denied = (await auditByAction(state.handle!, 'policy.apply')).filter(
      (log) => log.result === 'denied',
    );
    expect(denied).toHaveLength(deniedBefore.filter((log) => log.result === 'denied').length + 1);
    expect(denied.at(-1)).toMatchObject({ actorUserId: userId, targetId: 'action:applyPolicy' });
  });
});

describe('§4.7.1 Route Handler — POST /api/imports/* (USER)', () => {
  it.each(['sales', 'items', 'costs', 'parts'])(
    '%s: ① HTTP 403 + FORBIDDEN 봉투 ② 무변경 ③ import.upload denied 1행 ④ 배치 미생성',
    async (kind) => {
      const before = await snapshot();
      const auditBefore = await state.handle!.db.$count(auditLogs);
      const body = new FormData();
      body.set(
        'file',
        new File([new Uint8Array(fixtureBytes('sales-row-errors.xlsx'))], 'x.xlsx', {
          type: XLSX_MIME,
        }),
      );

      const response = await POST(
        new Request(`http://localhost/api/imports/${kind}`, { method: 'POST', body }),
        { params: Promise.resolve({ kind }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        ok: false,
        error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
      });
      expect(await snapshot()).toEqual(before);
      expect(await state.handle!.db.$count(auditLogs)).toBe(auditBefore + 1);
      const denied = await auditByAction(state.handle!, 'import.upload');
      expect(denied.at(-1)).toMatchObject({
        actorUserId: userId,
        result: 'denied',
        targetId: `/api/imports/${kind}`,
      });
    },
  );
});
