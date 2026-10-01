// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * PRAMI-003 §4.3.10 라우트 (AC-330 ①·②): `/api/health` 비인증 200·no-store·키 5개,
 * `/api/health/deep` USER → 403 봉투 + 감사 denied(PRAMI-001 §4.7.1), ADMIN → 개수·불리언만(이메일·원가 없음).
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

const { GET: health } = await import('@/app/api/health/route');
const { GET: deep } = await import('@/app/api/health/deep/route');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let userId: string;
let adminId: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  userId = (await insertUser(state.handle, { email: 'plain@pentasecurity.com', role: 'USER' })).id;
  adminId = (await insertUser(state.handle, { email: 'boss@pentasecurity.com', role: 'ADMIN' })).id;
  await insertUser(state.handle, { email: 'fixture-user@pentasecurity.com', role: 'USER' });
});

afterAll(async () => {
  await state.handle?.close();
});

describe('GET /api/health', () => {
  it('비인증 200, no-store, 키는 ok·release·db·schema·data 뿐 (로컬은 fixture 조회 없이 data:ok)', async () => {
    state.sessionUserId = undefined;
    const response = await health();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['data', 'db', 'ok', 'release', 'schema']);
    expect(body).toMatchObject({ ok: true, db: 'ok', schema: 'ok', data: 'ok' });
  });
});

describe('GET /api/health/deep', () => {
  it('USER → 403 FORBIDDEN + 감사 health.deep denied', async () => {
    state.sessionUserId = userId;
    invalidateSessionUser(userId);
    const response = await deep();
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    const denied = await auditByAction(state.handle!, 'health.deep');
    expect(denied.some((log) => log.actorUserId === userId && log.result === 'denied')).toBe(true);
  });

  it('비로그인 → 401', async () => {
    state.sessionUserId = undefined;
    expect((await deep()).status).toBe(401);
  });

  it('ADMIN → fixture 수·stub 수·행 수·KEK·rate limit 상태 (이메일·원가 없음)', async () => {
    state.sessionUserId = adminId;
    invalidateSessionUser(adminId);
    const response = await deep();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.data).toEqual({
      fixtureAccounts: 1,
      stubItems: 0,
      items: 0,
      salesPrices: 0,
      costRows: 0,
      kekActive: true,
      rateLimit: { backend: 'memory', reachable: true },
    });
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });
});
