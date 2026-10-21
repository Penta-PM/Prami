// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';

import { createTestDb } from '../../helpers/pglite';

/**
 * 원가 비중 실패 격리 (migration-apply-lan §2-3): cost_item_links 가 없는 DB(0009 미적용)에서도 가격정책 화면이 죽지 않는다 —
 * 서버 로그 + 빈 결과 + failed. 권한 없으면 null(열 없음, 안내 없음).
 */
const state = vi.hoisted(() => ({
  db: null as unknown,
  role: 'ADMIN' as 'ADMIN' | 'USER' | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.db,
}));
vi.mock('@/server/auth/rbac', () => ({
  getSessionUser: async () =>
    state.role ? { id: 'u1', email: 'admin@pentasecurity.com', role: state.role } : null,
  requirePagePermission: vi.fn(),
  requirePermission: vi.fn(),
}));

const { loadPolicyCostColumns } = await import('@/features/costs/price-ratios');

const rows = (...ids: number[]) => ids.map((id) => ({ id, itemCode: `P${id}` }));

let handle: DbHandle;

beforeAll(async () => {
  handle = await createTestDb();
  state.db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(() => {
  state.role = 'ADMIN';
});

describe('loadPolicyCostColumns (원가 비중 + 원가 매핑, policy-cost-link-column §2.2-2)', () => {
  it('테이블이 있으면 failed=false (대상 행 없으면 빈 비중, 품목마다 매핑 칸), ADMIN = cost.write', async () => {
    expect(await loadPolicyCostColumns(rows(1, 2))).toEqual({
      ratios: {},
      links: {
        P1: { inScope: false, link: null },
        P2: { inScope: false, link: null },
      },
      canEditLinks: true,
      failed: false,
    });
  });

  it('원가 권한 없으면 null — 열·안내 없음(계산·로그 없음)', async () => {
    state.role = 'USER';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await loadPolicyCostColumns(rows(1))).toBeNull();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('cost_item_links 가 없는 DB(0009 미적용) → 던지지 않고 두 열 모두 failed=true(빈 값) + 서버 로그 pricing.cost_ratio_failed', async () => {
    await handle.db.execute(sql`drop table cost_item_links`);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await loadPolicyCostColumns(rows(1, 2, 3))).toEqual({
      ratios: {},
      links: {},
      canEditLinks: true,
      failed: true,
    });
    const line = JSON.parse(String(error.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'error', event: 'pricing.cost_ratio_failed', rows: 3 });
    error.mockRestore();
  });
});
