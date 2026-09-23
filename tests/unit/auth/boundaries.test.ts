// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 경계 모듈: proxy(1차 방어, AC-03), 로그인 Server Actions, 요청 메타.
 * Auth.js 의 auth() 래퍼는 요청에 세션을 붙여 핸들러를 부르는 것으로 대체한다.
 */
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string; role: 'USER' | 'ADMIN' } },
  audits: [] as unknown[],
  headers: new Headers(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/server/auth/auth', () => ({
  auth:
    (handler: (request: NextRequest & { auth: unknown }) => unknown) => (request: NextRequest) =>
      handler(Object.assign(request, { auth: state.session })),
  signIn: state.signIn,
  signOut: state.signOut,
}));
// next-auth 의 ESM 번들은 Node 에서 next/server 를 확장자 없이 import 해 직접 로드할 수 없다
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));
vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/server/audit/log', () => ({
  AUDIT_ACTIONS: { accessDenied: 'auth.access_denied' },
  writeAudit: async (_db: unknown, entry: unknown) => {
    state.audits.push(entry);
  },
}));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const { default: proxy, config } = await import('@/proxy');
const actions = await import('@/features/auth/actions');
const { currentRequestMeta, requestMetaFromHeaders } = await import('@/server/audit/request-meta');
const { AuthError } = await import('next-auth');

type ProxyFn = (request: NextRequest) => Promise<Response>;
const run = (path: string, headers?: Record<string, string>) =>
  (proxy as unknown as ProxyFn)(new NextRequest(`http://localhost:3000${path}`, { headers }));

beforeEach(() => {
  state.session = null;
  state.audits = [];
  vi.clearAllMocks();
});

describe('proxy (1차 방어)', () => {
  it('AC-03: 비로그인 페이지 요청은 /login?callbackUrl= 로 리다이렉트', async () => {
    const response = await run('/pricing?x=1');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login?callbackUrl=%2Fpricing%3Fx%3D1',
    );
  });

  it('비로그인 API 요청은 401 봉투', async () => {
    const response = await run('/api/audit/export.csv');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('AC-03: USER 가 /admin/* 접근 → / 로 리다이렉트 + 감사 denied (IP 포함)', async () => {
    state.session = { user: { id: 'u1', email: 'user@pentasecurity.com', role: 'USER' } };
    const response = await run('/admin/policies', { 'x-forwarded-for': '10.9.8.7' });
    expect(response.headers.get('location')).toBe('http://localhost:3000/');
    expect(state.audits).toEqual([
      expect.objectContaining({
        action: 'auth.access_denied',
        actor: { id: 'u1', label: 'user@pentasecurity.com' },
        target: expect.objectContaining({ id: '/admin/policies' }),
        result: 'denied',
        meta: expect.objectContaining({ ip: '10.9.8.7' }),
      }),
    ]);
  });

  it('ADMIN 과 일반 경로는 통과', async () => {
    state.session = { user: { id: 'a1', role: 'ADMIN' } };
    expect((await run('/admin/users')).headers.get('x-middleware-next')).toBe('1');
    state.session = { user: { id: 'u1', role: 'USER' } };
    expect((await run('/pricing')).headers.get('x-middleware-next')).toBe('1');
    expect(state.audits).toHaveLength(0);
  });

  it('matcher 는 로그인·Auth.js·정적 자원을 제외한다', () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    expect(pattern.test('/pricing')).toBe(true);
    expect(pattern.test('/admin/users')).toBe(true);
    expect(pattern.test('/login')).toBe(false);
    expect(pattern.test('/api/auth/session')).toBe(false);
    expect(pattern.test('/logo-prami-mark.png')).toBe(false);
  });
});

describe('로그인 Server Actions', () => {
  const form = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  };

  it('Google 로그인은 안전한 callbackUrl 로 signIn 을 부른다', async () => {
    await actions.signInWithGoogle(form({ callbackUrl: '//evil.example' }));
    expect(state.signIn).toHaveBeenCalledWith('google', { redirectTo: '/' });
  });

  it('테스트 로그인 성공은 Auth.js 의 리다이렉트를 그대로 전파한다', async () => {
    state.signIn.mockRejectedValueOnce(new Error('NEXT_REDIRECT:/pricing'));
    await expect(
      actions.signInWithTestAccount(
        form({ email: 'a@pentasecurity.com', password: 'pw', callbackUrl: '/pricing' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT:/pricing');
    expect(state.signIn).toHaveBeenCalledWith('test', {
      email: 'a@pentasecurity.com',
      password: 'pw',
      redirectTo: '/pricing',
    });
  });

  it('테스트 로그인 실패(AuthError)는 사유 코드와 함께 /login 으로 돌아간다', async () => {
    const error = Object.assign(new AuthError('denied'), { code: 'inactive' });
    state.signIn.mockRejectedValueOnce(error);
    await expect(actions.signInWithTestAccount(form({ callbackUrl: '/pricing' }))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=inactive&callbackUrl=%2Fpricing',
    );
  });

  it('로그아웃은 /login 으로', async () => {
    await actions.signOutAction();
    expect(state.signOut).toHaveBeenCalledWith({ redirectTo: '/login' });
  });
});

describe('request-meta', () => {
  it('x-forwarded-for → x-real-ip 순으로 IP 를 읽는다', async () => {
    expect(requestMetaFromHeaders(new Headers({ 'x-real-ip': '1.2.3.4' }))).toEqual({
      ip: '1.2.3.4',
      userAgent: null,
    });
    state.headers = new Headers({ 'x-forwarded-for': '5.6.7.8', 'user-agent': 'ua' });
    expect(await currentRequestMeta()).toEqual({ ip: '5.6.7.8', userAgent: 'ua' });
  });
});
