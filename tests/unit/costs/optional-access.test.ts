// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 원가 비중 열의 노출 조건 (cost-ratio-price-change §2.3-1): cost.read 가 있으면 read 토큰, 없으면 null(열 없음).
 * 거부가 아니라 "열 없음"이라 감사 denied 를 남기지 않는다. 실제 역할은 USER·ADMIN 둘뿐이라 "pricing.write 만 가진 역할"은
 * 권한 표를 조작해 확인한다.
 */
const state = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: 'USER' | 'ADMIN' } | null,
  denyCostRead: false,
  audits: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/auth/rbac', () => ({
  getSessionUser: async () => state.user,
  requirePagePermission: vi.fn(),
  requirePermission: vi.fn(async () => {
    state.audits += 1;
    throw new Error('denied');
  }),
}));
vi.mock('@/lib/constants/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/constants/permissions')>();
  return {
    ...actual,
    hasPermission: (role: Parameters<typeof actual.hasPermission>[0], key: string) =>
      key === 'cost.read' && state.denyCostRead
        ? false
        : actual.hasPermission(role, key as Parameters<typeof actual.hasPermission>[1]),
  };
});

const { optionalCostReadAccess } = await import('@/server/cost/access');
const { hasPermission } = await import('@/lib/constants/permissions');

beforeEach(() => {
  state.user = null;
  state.denyCostRead = false;
  state.audits = 0;
});

describe('optionalCostReadAccess', () => {
  it('ADMIN(cost.read): read 범위 토큰', async () => {
    state.user = { id: 'a1', email: 'admin@pentasecurity.com', role: 'ADMIN' };
    expect(await optionalCostReadAccess()).toMatchObject({
      userId: 'a1',
      email: 'admin@pentasecurity.com',
      scope: 'read',
    });
  });

  it('USER: null (감사 denied 없음)', async () => {
    state.user = { id: 'u1', email: 'user@pentasecurity.com', role: 'USER' };
    expect(await optionalCostReadAccess()).toBeNull();
    expect(state.audits).toBe(0);
  });

  it('권한 조작: pricing.write 는 있고 cost.read 만 없는 역할 → null', async () => {
    state.user = { id: 'a1', email: 'admin@pentasecurity.com', role: 'ADMIN' };
    state.denyCostRead = true;
    expect(hasPermission('ADMIN', 'pricing.write')).toBe(true);
    expect(await optionalCostReadAccess()).toBeNull();
    expect(state.audits).toBe(0);
  });

  it('비로그인: null', async () => {
    expect(await optionalCostReadAccess()).toBeNull();
  });
});
