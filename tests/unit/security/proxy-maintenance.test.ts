// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PRAMI-003 proxy 추가분: `MAINTENANCE_MODE`(런북 R-3 — 비 ADMIN 503, ADMIN·로그인·헬스는 통과, Q-13),
 * `/api/health` 공개(정확한 경로만 — deep 은 세션 필요), 헬스 IP 상한(§4.3.10).
 */
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: 'USER' | 'ADMIN' } },
  maintenance: false,
}));

vi.mock('@/server/auth/auth', () => ({
  auth:
    (handler: (request: NextRequest & { auth: unknown }) => unknown) => (request: NextRequest) =>
      handler(Object.assign(request, { auth: state.session })),
}));
vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    ...actual,
    get env() {
      return { ...actual.env, MAINTENANCE_MODE: state.maintenance };
    },
  };
});

const {
  default: proxy,
  isOpenDuringMaintenance,
  isPublicPath,
  MAINTENANCE_MESSAGE,
} = await import('@/proxy');
const { rateLimiters } = await import('@/server/rate-limit');

type ProxyFn = (request: NextRequest) => Promise<Response>;
const run = (path: string, method = 'GET') =>
  (proxy as unknown as ProxyFn)(new NextRequest(`http://localhost:3000${path}`, { method }));

beforeEach(() => {
  state.session = null;
  state.maintenance = false;
  for (const limiter of Object.values(rateLimiters)) {
    limiter.reset();
    limiter.configure(1000);
  }
});

describe('공개 경로 /api/health', () => {
  it('/api/health 는 비인증 통과, /api/health/deep 은 401', async () => {
    expect(isPublicPath('/api/health')).toBe(true);
    expect(isPublicPath('/api/health/deep')).toBe(false);
    expect((await run('/api/health')).headers.get('x-middleware-next')).toBe('1');
    expect((await run('/api/health/deep')).status).toBe(401);
  });

  it('헬스는 IP 버킷 상한을 넘으면 429', async () => {
    rateLimiters.health.configure(1);
    expect((await run('/api/health')).headers.get('x-middleware-next')).toBe('1');
    expect((await run('/api/health')).status).toBe(429);
  });
});

describe('MAINTENANCE_MODE (런북 R-3)', () => {
  it('꺼져 있으면 기존 동작', async () => {
    state.session = { user: { id: 'u1', role: 'USER' } };
    expect((await run('/pricing')).headers.get('x-middleware-next')).toBe('1');
  });

  it('켜지면 USER 의 페이지·API·공유 링크는 503 안내', async () => {
    state.maintenance = true;
    state.session = { user: { id: 'u1', role: 'USER' } };
    const page = await run('/pricing');
    expect(page.status).toBe(503);
    expect(page.headers.get('retry-after')).toBe('300');
    expect(await page.text()).toContain(MAINTENANCE_MESSAGE);
    expect(page.headers.get('content-security-policy')).toMatch(/nonce-/);
    const api = await run('/api/chat', 'POST');
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({
      ok: false,
      error: { code: 'MAINTENANCE', message: MAINTENANCE_MESSAGE },
    });
    state.session = null;
    expect((await run(`/share/quotes/${'a'.repeat(64)}`)).status).toBe(503);
  });

  it('켜져 있어도 ADMIN 은 통과하고, 로그인·auth·헬스는 누구나 열린다', async () => {
    state.maintenance = true;
    state.session = { user: { id: 'a1', role: 'ADMIN' } };
    expect((await run('/admin/policies')).headers.get('x-middleware-next')).toBe('1');
    state.session = null;
    for (const path of ['/login', '/api/auth/session', '/api/health']) {
      expect(isOpenDuringMaintenance(path)).toBe(true);
      expect((await run(path)).status).not.toBe(503);
    }
    expect(isOpenDuringMaintenance('/api/health/deep')).toBe(false);
  });
});
