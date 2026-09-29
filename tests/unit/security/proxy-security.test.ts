// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * proxy 보안 계층 (AC-91·95): 모든 문서·API 응답에 요청별 CSP nonce + x-request-id, 로그인·공유 페이지에도 적용,
 * 다음 단계로 nonce·CSP 요청 헤더 전달, 공유·PDF·auth 콜백 IP 기준 분당 상한 → 429 + Retry-After, 다른 IP 는 영향 없음.
 */
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string; role: 'USER' | 'ADMIN' } },
}));

vi.mock('@/server/auth/auth', () => ({
  auth:
    (handler: (request: NextRequest & { auth: unknown }) => unknown) => (request: NextRequest) =>
      handler(Object.assign(request, { auth: state.session })),
}));
vi.mock('@/db', () => ({ getDb: async () => ({}) }));

const { default: proxy } = await import('@/proxy');
const { rateLimiters } = await import('@/server/rate-limit');

type ProxyFn = (request: NextRequest) => Promise<Response>;
const run = (path: string, init: { headers?: Record<string, string>; method?: string } = {}) =>
  (proxy as unknown as ProxyFn)(new NextRequest(`http://localhost:3000${path}`, init));

const nonceOf = (csp: string | null) => /'nonce-([^']+)'/.exec(csp ?? '')?.[1];

beforeEach(() => {
  state.session = null;
  for (const limiter of Object.values(rateLimiters)) {
    limiter.reset();
    limiter.configure(1000);
  }
});

describe('CSP · 요청 ID (AC-91)', () => {
  it('로그인·공유(공개)와 앱 경로(로그인 사용자) 모두 CSP nonce + x-request-id, 요청마다 nonce 가 다르다', async () => {
    const login = await run('/login');
    const share = await run(`/share/quotes/${'a'.repeat(64)}`);
    state.session = { user: { id: 'u1', role: 'USER' } };
    const app = await run('/calculator');
    for (const response of [login, share, app]) {
      const csp = response.headers.get('content-security-policy');
      expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
    const nonces = [login, share, app].map((response) =>
      nonceOf(response.headers.get('content-security-policy')),
    );
    expect(new Set(nonces).size).toBe(3);
  });

  it('다음 단계(페이지)로 x-nonce·CSP·요청 ID 요청 헤더를 넘긴다 (Next 가 인라인 스크립트에 nonce 를 붙이도록)', async () => {
    const response = await run('/login', { headers: { 'x-request-id': 'upstream-req-0001' } });
    const nonce = nonceOf(response.headers.get('content-security-policy'));
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toContain(
      `'nonce-${nonce}'`,
    );
    expect(response.headers.get('x-request-id')).toBe('upstream-req-0001');
  });

  it('리다이렉트·401 응답에도 CSP 가 붙는다', async () => {
    const redirect = await run('/pricing');
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get('content-security-policy')).toContain("default-src 'self'");
    const unauthorized = await run('/api/chat', { method: 'POST' });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('content-security-policy')).toBeTruthy();
  });
});

describe('IP 기준 rate limit (AC-95)', () => {
  it('비로그인 공유 페이지: 같은 IP 31번째 → 429 + Retry-After + RATE_LIMITED, 다른 IP 는 200', async () => {
    rateLimiters.share.configure(30);
    const path = `/share/quotes/${'b'.repeat(64)}`;
    const from = (ip: string) => ({ headers: { 'x-forwarded-for': ip } });
    for (let index = 0; index < 30; index += 1) {
      expect((await run(path, from('10.0.0.1'))).status).toBe(200);
    }
    const limited = await run(path, from('10.0.0.1'));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(limited.headers.get('content-security-policy')).toBeTruthy();
    expect(await limited.json()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    expect((await run(path, from('10.0.0.2'))).status).toBe(200);
  });

  it('PDF(GET)·auth 콜백도 IP 버킷, 그 외 경로는 제한하지 않는다', async () => {
    rateLimiters.pdf.configure(1);
    rateLimiters.authCallback.configure(1);
    state.session = { user: { id: 'u1', role: 'USER' } };
    const pdf = '/api/quotes/11111111-1111-4111-8111-111111111111/pdf';
    expect((await run(pdf)).status).toBe(200);
    expect((await run(pdf)).status).toBe(429);
    expect((await run('/api/auth/callback/google')).status).toBe(200);
    expect((await run('/api/auth/callback/google')).status).toBe(429);
    for (let index = 0; index < 5; index += 1) {
      expect((await run('/calculator')).status).toBe(200);
    }
  });
});
