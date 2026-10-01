// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';

import { createTestDb } from '../../helpers/pglite';

/**
 * PRAMI-003 PR-3 — 실제 Auth.js(next-auth) 핸들러로 로그인 시작·콜백 응답을 검사한다 (실 Google 호출 0).
 * - AC-342 리다이렉트 프록시: preview 배포별 호스트 → Google `redirect_uri` 는 고정 호스트 콜백, `hd` 파라미터,
 *   고정 호스트가 state 를 풀어 원래 preview 콜백으로 되돌림. production 은 운영 도메인 콜백
 * - AC-343 쿠키·세션: https AUTH_URL 에서 `__Secure-` 접두, HttpOnly·Secure·SameSite=Lax, 만료 8시간
 * Google 디스커버리 문서는 fetch 스텁이 돌려준다. 그 밖의 외부 요청은 스텁이 실패시킨다.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  env: {} as Record<string, string>,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    ...actual,
    get env() {
      return actual.parseEnv(state.env);
    },
  };
});
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: '127.0.0.1', userAgent: 'vitest' }),
}));

const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const DISCOVERY = `${GOOGLE_ISSUER}/.well-known/openid-configuration`;
/** 테스트 전용 더미 값 (실제 클라이언트·시크릿 아님) */
const DUMMY_SECRET = 'dummy-auth-secret-for-vitest-only-0123456789';
const FIXED_PREVIEW = 'https://prami-preview.example.com';
const BRANCH_PREVIEW = 'https://prami-git-feature-x-team.vercel.app';
const PRODUCTION = 'https://prami.example.com';

const fetchCalls: string[] = [];

/** Google 디스커버리만 응답하고, 그 외 외부 호출은 실패시킨다 (실 Google 호출 0 보장) */
function stubGoogleDiscovery() {
  fetchCalls.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchCalls.push(url);
    if (url !== DISCOVERY) throw new Error(`예상하지 못한 외부 요청: ${url}`);
    return new Response(
      JSON.stringify({
        issuer: GOOGLE_ISSUER,
        authorization_endpoint: GOOGLE_AUTHORIZE,
        token_endpoint: 'https://oauth2.googleapis.com/token',
        userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
        jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
        code_challenge_methods_supported: ['plain', 'S256'],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

type Deployment = {
  /** 이 배포의 env (src/env 스키마 입력) */
  env: Record<string, string>;
  /** next-auth 가 process.env 에서 직접 읽는 키 */
  processEnv: Record<string, string | undefined>;
};

const BASE_ENV = {
  NODE_ENV: 'test',
  AUTH_SECRET: DUMMY_SECRET,
  AUTH_GOOGLE_ID: 'dummy-client-id.apps.googleusercontent.com',
  AUTH_GOOGLE_SECRET: 'dummy-google-client-secret',
  AUTH_REQUIRE_HD: 'true',
  CHAT_LLM_ENABLED: 'false',
};

/** 배포 하나를 흉내 내 auth 모듈을 새로 읽는다 (next-auth 는 NextAuth() 호출 시점에 process.env 를 반영) */
async function loadHandlers(deployment: Deployment) {
  state.env = deployment.env;
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(deployment.processEnv)) vi.stubEnv(key, value);
  vi.resetModules();
  const mod = await import('@/server/auth/auth');
  return mod.handlers;
}

type Handlers = Awaited<ReturnType<typeof loadHandlers>>;

function cookiePairs(response: Response): string[] {
  return response.headers.getSetCookie().map((line) => line.split(';')[0]!);
}

/** csrf 토큰을 받아 Google 로그인 시작(POST /signin/google) → 302 응답 */
async function startGoogleSignIn(handlers: Handlers, origin: string) {
  const host = new URL(origin).host;
  const csrfResponse = await handlers.GET(
    new NextRequest(`${origin}/api/auth/csrf`, { headers: { host } }),
  );
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const response = await handlers.POST(
    new NextRequest(`${origin}/api/auth/signin/google`, {
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookiePairs(csrfResponse).join('; '),
      },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${origin}/` }).toString(),
    }),
  );
  return { response, csrfResponse };
}

beforeAll(async () => {
  state.handle = await createTestDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await state.handle?.close();
});

/** preview 설정 (docs/deploy/oauth.md): 모든 preview 배포가 같은 AUTH_SECRET·AUTH_REDIRECT_PROXY_URL, AUTH_URL 미설정 */
const PREVIEW: Deployment = {
  env: {
    ...BASE_ENV,
    AUTH_REDIRECT_PROXY_URL: `${FIXED_PREVIEW}/api/auth`,
    NEXT_PUBLIC_APP_URL: FIXED_PREVIEW,
  },
  processEnv: {
    AUTH_SECRET: DUMMY_SECRET,
    AUTH_REDIRECT_PROXY_URL: `${FIXED_PREVIEW}/api/auth`,
    AUTH_URL: undefined,
  },
};

describe('AC-342 preview 리다이렉트 프록시', () => {
  it('배포별 preview 호스트의 로그인 시작 → Google redirect_uri 는 고정 호스트 콜백, hd 파라미터 포함', async () => {
    stubGoogleDiscovery();
    const handlers = await loadHandlers(PREVIEW);

    const { response } = await startGoogleSignIn(handlers, BRANCH_PREVIEW);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(GOOGLE_AUTHORIZE);
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${FIXED_PREVIEW}/api/auth/callback/google`,
    );
    expect(location.searchParams.get('hd')).toBe('pentasecurity.com');
    expect(location.searchParams.get('scope')).toBe('openid profile email');
    expect(location.searchParams.get('client_id')).toBe(BASE_ENV.AUTH_GOOGLE_ID);
    expect(location.searchParams.get('state')).toBeTruthy();
    // 외부 요청은 디스커버리 문서뿐 (실 Google 인가·토큰 호출 0)
    expect(new Set(fetchCalls)).toEqual(new Set([DISCOVERY]));
  });

  it('고정 호스트는 state 를 검증·해독해 원래 preview 콜백으로 302 한다 (code·state 그대로 전달)', async () => {
    stubGoogleDiscovery();
    const branch = await loadHandlers(PREVIEW);
    const { response } = await startGoogleSignIn(branch, BRANCH_PREVIEW);
    const googleState = new URL(response.headers.get('location')!).searchParams.get('state')!;

    // Google → 고정 호스트 콜백 (같은 preview AUTH_SECRET·프록시 설정)
    const fixed = await loadHandlers(PREVIEW);
    const bounce = await fixed.GET(
      new NextRequest(
        `${FIXED_PREVIEW}/api/auth/callback/google?code=dummy-code&state=${encodeURIComponent(googleState)}`,
        { headers: { host: new URL(FIXED_PREVIEW).host } },
      ),
    );

    expect(bounce.status).toBe(302);
    const back = new URL(bounce.headers.get('location')!);
    expect(`${back.origin}${back.pathname}`).toBe(`${BRANCH_PREVIEW}/api/auth/callback/google`);
    expect(back.searchParams.get('code')).toBe('dummy-code');
    expect(back.searchParams.get('state')).toBe(googleState);
    expect(fetchCalls.filter((url) => url !== DISCOVERY)).toEqual([]);
  });

  it('AUTH_SECRET 이 다른 배포(production 등)의 state 는 고정 호스트가 되돌리지 않는다', async () => {
    stubGoogleDiscovery();
    const other = await loadHandlers({
      env: { ...PREVIEW.env, AUTH_SECRET: `${DUMMY_SECRET}-other` },
      processEnv: { ...PREVIEW.processEnv, AUTH_SECRET: `${DUMMY_SECRET}-other` },
    });
    const { response } = await startGoogleSignIn(other, BRANCH_PREVIEW);
    const foreignState = new URL(response.headers.get('location')!).searchParams.get('state')!;

    const fixed = await loadHandlers(PREVIEW);
    const bounce = await fixed.GET(
      new NextRequest(
        `${FIXED_PREVIEW}/api/auth/callback/google?code=dummy-code&state=${encodeURIComponent(foreignState)}`,
        { headers: { host: new URL(FIXED_PREVIEW).host } },
      ),
    );

    const location = bounce.headers.get('location') ?? '';
    expect(location.startsWith(BRANCH_PREVIEW)).toBe(false);
  });

  it('preview 에 AUTH_URL(고정 호스트)을 두면 배포별 origin 이 state 에 실리지 않아 고정 호스트가 되돌리지 못한다 — preview 는 AUTH_URL 미설정', async () => {
    stubGoogleDiscovery();
    const misconfigured: Deployment = {
      env: { ...PREVIEW.env, AUTH_URL: FIXED_PREVIEW },
      processEnv: { ...PREVIEW.processEnv, AUTH_URL: FIXED_PREVIEW },
    };
    const branch = await loadHandlers(misconfigured);
    const { response } = await startGoogleSignIn(branch, BRANCH_PREVIEW);
    const googleState = new URL(response.headers.get('location')!).searchParams.get('state')!;

    const fixed = await loadHandlers(PREVIEW);
    const bounce = await fixed.GET(
      new NextRequest(
        `${FIXED_PREVIEW}/api/auth/callback/google?code=dummy-code&state=${encodeURIComponent(googleState)}`,
        { headers: { host: new URL(FIXED_PREVIEW).host } },
      ),
    );

    // 배포별 preview 로 돌아가지 않는다 (state·PKCE 쿠키는 배포별 호스트에 있어 로그인 실패)
    expect((bounce.headers.get('location') ?? '').startsWith(BRANCH_PREVIEW)).toBe(false);
  });

  it('production 설정(AUTH_URL=운영 도메인, 프록시 없음) → redirect_uri 는 운영 도메인 콜백', async () => {
    stubGoogleDiscovery();
    const handlers = await loadHandlers({
      env: { ...BASE_ENV, AUTH_URL: PRODUCTION, NEXT_PUBLIC_APP_URL: PRODUCTION },
      processEnv: {
        AUTH_SECRET: DUMMY_SECRET,
        AUTH_URL: PRODUCTION,
        AUTH_REDIRECT_PROXY_URL: undefined,
      },
    });

    const { response } = await startGoogleSignIn(handlers, PRODUCTION);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${PRODUCTION}/api/auth/callback/google`,
    );
    expect(location.searchParams.get('hd')).toBe('pentasecurity.com');
  });
});

describe('AC-343 세션 쿠키 속성 (https AUTH_URL)', () => {
  it('로그인 시작 쿠키(state·pkce·callback-url)는 __Secure- 접두 + HttpOnly·Secure·SameSite=Lax', async () => {
    stubGoogleDiscovery();
    const handlers = await loadHandlers({
      env: { ...BASE_ENV, AUTH_URL: PRODUCTION, NEXT_PUBLIC_APP_URL: PRODUCTION },
      processEnv: { AUTH_SECRET: DUMMY_SECRET, AUTH_URL: PRODUCTION },
    });

    const { response, csrfResponse } = await startGoogleSignIn(handlers, PRODUCTION);
    const lines = [...csrfResponse.headers.getSetCookie(), ...response.headers.getSetCookie()];

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^__(Secure|Host)-authjs\./);
      expect(line).toMatch(/;\s*HttpOnly/i);
      expect(line).toMatch(/;\s*Secure/i);
      expect(line).toMatch(/;\s*SameSite=Lax/i);
    }
  });

  it('세션 토큰 쿠키: __Secure-authjs.session-token, HttpOnly·Secure·SameSite=Lax, 만료 8시간', async () => {
    const handlers = await loadHandlers({
      env: {
        ...BASE_ENV,
        AUTH_URL: PRODUCTION,
        NEXT_PUBLIC_APP_URL: PRODUCTION,
        // 세션 발급만 확인하려고 테스트 Credentials 를 쓴다 (NODE_ENV=test — 운영에서는 등록되지 않음)
        AUTH_TEST_MODE: 'true',
        AUTH_TEST_PASSWORD: 'fixture-pass',
        AUTH_TEST_ALLOWED_HOSTS: 'prami.example.com',
      },
      processEnv: { AUTH_SECRET: DUMMY_SECRET, AUTH_URL: PRODUCTION },
    });
    const host = new URL(PRODUCTION).host;
    const csrfResponse = await handlers.GET(
      new NextRequest(`${PRODUCTION}/api/auth/csrf`, { headers: { host } }),
    );
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
    const before = Date.now();

    const response = await handlers.POST(
      new NextRequest(`${PRODUCTION}/api/auth/callback/test`, {
        method: 'POST',
        headers: {
          host,
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookiePairs(csrfResponse).join('; '),
        },
        body: new URLSearchParams({
          csrfToken,
          email: 'session.cookie@pentasecurity.com',
          password: 'fixture-pass',
          callbackUrl: `${PRODUCTION}/`,
        }).toString(),
      }),
    );

    expect(response.status).toBe(302);
    const session = response.headers
      .getSetCookie()
      .find((line) => line.startsWith('__Secure-authjs.session-token='));
    expect(session).toBeDefined();
    expect(session).toMatch(/;\s*HttpOnly/i);
    expect(session).toMatch(/;\s*Secure/i);
    expect(session).toMatch(/;\s*SameSite=Lax/i);
    expect(session).toMatch(/;\s*Path=\//i);
    const expires = Date.parse(/Expires=([^;]+)/i.exec(session!)![1]!);
    const eightHours = 8 * 60 * 60 * 1000;
    expect(expires - before).toBeGreaterThan(eightHours - 60_000);
    expect(expires - before).toBeLessThan(eightHours + 60_000);
  });

  it('http(로컬) AUTH_URL 에서는 접두·Secure 가 붙지 않는다 (localhost 개발)', async () => {
    stubGoogleDiscovery();
    const local = 'http://localhost:3000';
    const handlers = await loadHandlers({
      env: { ...BASE_ENV, AUTH_REQUIRE_HD: 'false', AUTH_URL: local },
      processEnv: { AUTH_SECRET: DUMMY_SECRET, AUTH_URL: local },
    });

    const { response } = await startGoogleSignIn(handlers, local);

    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('redirect_uri')).toBe(`${local}/api/auth/callback/google`);
    for (const line of response.headers.getSetCookie()) {
      expect(line).toMatch(/^authjs\./);
      expect(line).not.toMatch(/;\s*Secure/i);
    }
  });
});
