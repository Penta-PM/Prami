// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { hasPermission, ROLES } from '@/lib/constants/permissions';
import { AppError } from '@/lib/result';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조달이 통합 DB-2 권한 (D-1): procurement.read = USER·ADMIN, procurement.write = ADMIN, 비로그인 거부.
 * 실제 세션 경로(requirePermission·requirePagePermission)로 토큰을 얻고, 거부는 감사 denied 를 남긴다. 모든 조회 함수는 토큰을 검사한다.
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
  currentRequestMeta: async () => ({ ip: '198.51.100.4', userAgent: 'vitest' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const { requireProcurementAccess, requireProcurementPageAccess } =
  await import('@/server/procurement/access');
const { assertProcurementAccess, procurementAccessForTests } =
  await import('@/server/procurement/access-token');
const queries = await import('@/server/procurement/queries');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  state.sessionUserId = undefined;
});

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('거부되지 않았습니다');
    },
    (error: unknown) => error,
  );
}

describe('권한 매트릭스 (D-1)', () => {
  it('procurement.read = USER·ADMIN, procurement.write = ADMIN', () => {
    expect(ROLES.filter((role) => hasPermission(role, 'procurement.read'))).toEqual([
      'USER',
      'ADMIN',
    ]);
    expect(ROLES.filter((role) => hasPermission(role, 'procurement.write'))).toEqual(['ADMIN']);
    expect(hasPermission(null, 'procurement.read')).toBe(false);
  });
});

describe('requireProcurementAccess (Action/Route)', () => {
  it('비로그인: read·write 모두 UNAUTHENTICATED', async () => {
    for (const scope of ['read', 'write'] as const) {
      const error = await caught(requireProcurementAccess(scope, 'action:test'));
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('UNAUTHENTICATED');
    }
  });

  it('USER: read 허용(토큰), write 거부(FORBIDDEN + 감사 procurement.write denied)', async () => {
    state.sessionUserId = userId;
    expect(await requireProcurementAccess('read', 'action:list')).toMatchObject({
      userId,
      email: 'user@pentasecurity.com',
      scope: 'read',
    });
    const before = (await auditByAction(state.handle!, 'procurement.write')).length;
    const error = await caught(requireProcurementAccess('write', 'action:excludeDelivery'));
    expect((error as AppError).code).toBe('FORBIDDEN');
    const denied = await auditByAction(state.handle!, 'procurement.write');
    expect(denied).toHaveLength(before + 1);
    expect(denied.at(-1)).toMatchObject({
      actorUserId: userId,
      targetId: 'action:excludeDelivery',
      result: 'denied',
    });
  });

  it('ADMIN: read·write 허용', async () => {
    state.sessionUserId = adminId;
    expect(await requireProcurementAccess('read', 'action:list')).toMatchObject({ scope: 'read' });
    expect(await requireProcurementAccess('write', 'action:edit')).toMatchObject({
      userId: adminId,
      scope: 'write',
    });
  });
});

describe('requireProcurementPageAccess (페이지)', () => {
  it('비로그인 → /login (callbackUrl)', async () => {
    const error = await caught(requireProcurementPageAccess('/procurement'));
    expect(String((error as Error).message)).toBe(
      'NEXT_REDIRECT:/login?callbackUrl=%2Fprocurement',
    );
  });

  it('USER: 조회 화면 허용, 관리 화면(write) → / + 감사 denied', async () => {
    state.sessionUserId = userId;
    expect(await requireProcurementPageAccess('/procurement/items')).toMatchObject({
      scope: 'read',
    });
    const error = await caught(requireProcurementPageAccess('/admin/procurement', 'write'));
    expect(String((error as Error).message)).toBe('NEXT_REDIRECT:/');
    const denied = await auditByAction(state.handle!, 'auth.access_denied');
    expect(denied.at(-1)).toMatchObject({ targetId: '/admin/procurement', result: 'denied' });
  });

  it('ADMIN: 관리 화면 write 토큰', async () => {
    state.sessionUserId = adminId;
    expect(await requireProcurementPageAccess('/admin/procurement', 'write')).toMatchObject({
      scope: 'write',
    });
  });
});

describe('조회 함수의 토큰 검사', () => {
  it('토큰 없이 부르면 모든 조회 함수가 거부한다', async () => {
    const db = state.handle!.db;
    const none = null as unknown as Parameters<typeof queries.getProcurementItemRows>[0];
    const scope = { product: 'ALL' } as const;
    const period = { from: '2025-01', to: '2025-01' };
    const calls: [string, () => Promise<unknown>][] = [
      ['getProcurementItemRows', () => queries.getProcurementItemRows(none, db)],
      ['getProcurementItemRowsForExport', () => queries.getProcurementItemRowsForExport(none, db)],
      ['getProcurementItemFacets', () => queries.getProcurementItemFacets(none, db)],
      ['getProcurementItemPriceRange', () => queries.getProcurementItemPriceRange(none, db)],
      ['getBidNoticeRows', () => queries.getBidNoticeRows(none, db)],
      ['getPerformanceKpis', () => queries.getPerformanceKpis(none, db, { scope, period })],
      ['getMonthlySeries', () => queries.getMonthlySeries(none, db, { scope, period })],
      [
        'getMonthlySeriesByManufacturer',
        () => queries.getMonthlySeriesByManufacturer(none, db, { scope, period }),
      ],
      ['getMonthVolumes', () => queries.getMonthVolumes(none, db, { scope })],
      [
        'getManufacturerPerformance',
        () => queries.getManufacturerPerformance(none, db, { scope, period }),
      ],
      ['getMonthlyReport', () => queries.getMonthlyReport(none, db, { scope, month: '2025-01' })],
      [
        'getMonthlyReportByManufacturer',
        () => queries.getMonthlyReportByManufacturer(none, db, { scope, month: '2025-01' }),
      ],
      ['getMonthContracts', () => queries.getMonthContracts(none, db, { scope, month: '2025-01' })],
      ['getYearlyPerformance', () => queries.getYearlyPerformance(none, db, { scope })],
      ['getCollectionStatus', () => queries.getCollectionStatus(none, db)],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toThrow('조달 접근 토큰이 없습니다');
    }
    // 모든 export 된 조회 함수가 위 목록에 있다 (새 함수가 검사 없이 추가되는 것 방지)
    const exported = Object.entries(queries)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual(calls.map(([name]) => name).sort());
  });

  it('read 토큰은 write 검사에서 거부, write 토큰은 read·write 통과', () => {
    const read = procurementAccessForTests({ id: 'u', email: 'u@example.com' }, 'read');
    const write = procurementAccessForTests({ id: 'a', email: 'a@example.com' }, 'write');
    expect(() => assertProcurementAccess(read, 'read')).not.toThrow();
    expect(() => assertProcurementAccess(read, 'write')).toThrow('write 범위');
    expect(() => assertProcurementAccess(write, 'read')).not.toThrow();
    expect(() => assertProcurementAccess(write, 'write')).not.toThrow();
    expect(() => assertProcurementAccess(undefined, 'read')).toThrow('토큰이 없습니다');
  });
});
