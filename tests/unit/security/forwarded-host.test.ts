// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { allowedForwardedHosts, isForbiddenForwardedHost } from '@/server/security/forwarded-host';

/** PR #25 QA L-3: preview 에서 위조 X-Forwarded-Host 차단 (로그인 서버 액션 state 에 공격자 origin 봉인 방지) */
vi.mock('@/server/auth/auth', () => ({
  auth:
    (handler: (request: NextRequest & { auth: unknown }) => unknown) => (request: NextRequest) =>
      handler(Object.assign(request, { auth: null })),
}));
vi.mock('@/db', () => ({ getDb: async () => ({}) }));

const PREVIEW = {
  VERCEL_ENV: 'preview',
  VERCEL_URL: 'prami-abc123-team.vercel.app',
  VERCEL_BRANCH_URL: 'prami-git-feat-team.vercel.app',
  NEXT_PUBLIC_APP_URL: 'https://preview.prami.example.com',
};

describe('isForbiddenForwardedHost', () => {
  it.each([
    ['요청 Host 와 같음', 'prami-abc123-team.vercel.app', 'prami-abc123-team.vercel.app'],
    ['배포 URL(VERCEL_URL)', 'prami-abc123-team.vercel.app', 'x.example'],
    ['브랜치 URL', 'prami-git-feat-team.vercel.app', 'x.example'],
    ['고정 preview 호스트', 'Preview.Prami.Example.com', 'x.example'],
    ['프록시 체인 모두 허용', 'prami-abc123-team.vercel.app, preview.prami.example.com', 'h'],
  ])('preview 허용: %s', (_label, forwarded, host) => {
    expect(isForbiddenForwardedHost(forwarded, host, PREVIEW)).toBe(false);
  });

  it.each([
    ['공격자 호스트', 'evil.example.com'],
    ['체인 첫 값 위조', 'evil.example.com, prami-abc123-team.vercel.app'],
    ['체인 뒤 값 위조', 'prami-abc123-team.vercel.app, evil.example.com'],
    ['빈 값', ''],
    ['접미사 위장', 'prami-abc123-team.vercel.app.evil.com'],
  ])('preview 거부: %s', (_label, forwarded) => {
    expect(isForbiddenForwardedHost(forwarded, 'prami-abc123-team.vercel.app', PREVIEW)).toBe(true);
  });

  it('헤더가 없거나 preview 가 아니면(production·로컬) 검사하지 않는다', () => {
    expect(isForbiddenForwardedHost(null, 'h', PREVIEW)).toBe(false);
    expect(isForbiddenForwardedHost('evil.example.com', 'h', { VERCEL_ENV: 'production' })).toBe(
      false,
    );
    expect(isForbiddenForwardedHost('evil.example.com', 'h', {})).toBe(false);
  });

  it('허용 목록은 비어 있는 값·잘못된 URL 을 넣지 않는다', () => {
    expect([
      ...allowedForwardedHosts(null, { NEXT_PUBLIC_APP_URL: 'not a url', VERCEL_URL: ' ' }),
    ]).toEqual([]);
  });
});

describe('proxy 연결', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('preview: 위조 X-Forwarded-Host 로 /login 서버 액션·/api/auth 요청 → 400 봉투(CSP·요청 ID 유지), 정상 호스트는 통과', async () => {
    // env.ts 는 import 시 검증하므로 로컬 env 로 먼저 읽고, 판정이 실행 시 읽는 process.env 만 preview 로 바꾼다
    const { default: proxy } = await import('@/proxy');
    for (const [key, value] of Object.entries(PREVIEW)) vi.stubEnv(key, value);
    const run = (path: string, headers: Record<string, string>, method = 'GET') =>
      (proxy as unknown as (request: NextRequest) => Promise<Response>)(
        new NextRequest(`https://prami-abc123-team.vercel.app${path}`, { headers, method }),
      );
    for (const [path, method] of [
      ['/login', 'POST'],
      ['/api/auth/signin/google', 'POST'],
      ['/api/auth/callback/google', 'GET'],
    ] as const) {
      const blocked = await run(
        path,
        { 'x-forwarded-host': 'evil.example.com', 'next-action': 'a'.repeat(42) },
        method,
      );
      expect(blocked.status).toBe(400);
      expect((await blocked.json()).error.code).toBe('VALIDATION');
      expect(blocked.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(blocked.headers.get('x-request-id')).toBeTruthy();
    }
    const fine = await run('/login', { 'x-forwarded-host': 'prami-abc123-team.vercel.app' });
    expect(fine.status).not.toBe(400);
  });
});
