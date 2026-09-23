// @vitest-environment node
import type { NextAuthConfig } from 'next-auth';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { parseEnv } from '@/env';

import { createTestDb, findUserByEmail, insertUser } from '../../helpers/pglite';

/**
 * Auth.js 설정 (auth.ts) — NextAuth 를 가짜로 바꿔 설정 객체를 붙잡고 콜백을 직접 실행한다.
 * AC-02(테스트 모드 로그인)·AC-06(Google 판정 연결)·AC-07(production 에서 Credentials 미등록)
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  config: undefined as NextAuthConfig | undefined,
  env: {} as Record<string, string>,
}));

vi.mock('next-auth', () => {
  class CredentialsSignin extends Error {
    code = 'credentials';
  }
  return {
    CredentialsSignin,
    default: (config: NextAuthConfig) => {
      state.config = config;
      return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
    },
  };
});
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

const TEST_ENV = {
  NODE_ENV: 'test',
  AUTH_TEST_MODE: 'true',
  AUTH_TEST_PASSWORD: 'fixture-pass',
  ADMIN_EMAILS: 'fixture-admin@pentasecurity.com',
};

async function loadConfig(env: Record<string, string>): Promise<NextAuthConfig> {
  state.env = env;
  vi.resetModules();
  await import('@/server/auth/auth');
  if (!state.config) throw new Error('NextAuth 설정이 캡처되지 않았습니다');
  return state.config;
}

/** Credentials({ id }) 는 사용자 지정 id 를 options 에 두고 Auth.js 가 초기화 때 병합한다 */
function providerId(entry: NextAuthConfig['providers'][number]): string {
  const resolved = (typeof entry === 'function' ? entry() : entry) as {
    id: string;
    options?: { id?: string };
  };
  return resolved.options?.id ?? resolved.id;
}

const providerIds = (config: NextAuthConfig) => config.providers.map(providerId);

type AuthorizeFn = (credentials: Record<string, unknown>) => Promise<unknown>;

function testAuthorize(config: NextAuthConfig): AuthorizeFn {
  const provider = config.providers.find((entry) => providerId(entry) === 'test') as
    { options?: { authorize?: AuthorizeFn }; authorize?: AuthorizeFn } | undefined;
  const authorize = provider?.options?.authorize ?? provider?.authorize;
  if (!authorize) throw new Error('테스트 provider 가 없습니다');
  return authorize;
}

beforeAll(async () => {
  state.handle = await createTestDb();
});

afterAll(async () => {
  await state.handle?.close();
});

describe('provider 등록', () => {
  it('AUTH_TEST_MODE=true (비-production) 이면 테스트 Credentials 만 등록된다 (Google 미설정)', async () => {
    expect(providerIds(await loadConfig(TEST_ENV))).toEqual(['test']);
  });

  it('AC-07: production 에서는 Credentials 가 등록되지 않고 Google 만 남는다', async () => {
    const config = await loadConfig({
      NODE_ENV: 'production',
      AUTH_GOOGLE_ID: 'id',
      AUTH_GOOGLE_SECRET: 'secret',
    });
    expect(providerIds(config)).toEqual(['google']);
    expect(() =>
      parseEnv({ NODE_ENV: 'production', AUTH_TEST_MODE: 'true', AUTH_TEST_PASSWORD: 'x' }),
    ).toThrow(/AUTH_TEST_MODE/);
  });

  it('세션은 JWT 8시간, 로그인 페이지는 /login', async () => {
    const config = await loadConfig(TEST_ENV);
    expect(config.session).toEqual({ strategy: 'jwt', maxAge: 8 * 60 * 60 });
    expect(config.pages).toMatchObject({ signIn: '/login', error: '/login' });
  });
});

describe('테스트 Credentials authorize (AC-02 로그인)', () => {
  it('고정 비밀번호가 맞으면 ADMIN_EMAILS 부트스트랩을 거쳐 사용자를 돌려준다', async () => {
    const authorize = testAuthorize(await loadConfig(TEST_ENV));
    const user = await authorize({
      email: 'fixture-admin@pentasecurity.com',
      password: 'fixture-pass',
    });
    expect(user).toMatchObject({ email: 'fixture-admin@pentasecurity.com' });
    expect((await findUserByEmail(state.handle!, 'fixture-admin@pentasecurity.com'))?.role).toBe(
      'ADMIN',
    );
  });

  it('비밀번호가 틀리거나 비활성 사용자면 사유 코드와 함께 거부한다', async () => {
    const authorize = testAuthorize(await loadConfig(TEST_ENV));
    await expect(
      authorize({ email: 'fixture-admin@pentasecurity.com', password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'credentials' });
    await expect(authorize({ password: 'fixture-pass' })).rejects.toMatchObject({
      code: 'credentials',
    });

    await insertUser(state.handle!, { email: 'gone@pentasecurity.com', status: 'inactive' });
    await expect(
      authorize({ email: 'gone@pentasecurity.com', password: 'fixture-pass' }),
    ).rejects.toMatchObject({ code: 'inactive' });
  });
});

describe('callbacks', () => {
  it('signIn: Google 은 도메인 판정 결과로, 그 외 provider 는 통과', async () => {
    const config = await loadConfig(TEST_ENV);
    const signIn = config.callbacks!.signIn! as (params: unknown) => Promise<boolean | string>;

    expect(await signIn({ account: { provider: 'test' } })).toBe(true);
    expect(
      await signIn({
        account: { provider: 'google', providerAccountId: 'g-1' },
        profile: { email: 'someone@gmail.com', email_verified: true },
      }),
    ).toBe('/login?error=domain');
    expect(
      await signIn({
        account: { provider: 'google', providerAccountId: 'g-2' },
        profile: {
          email: 'google.user@pentasecurity.com',
          email_verified: true,
          name: '구글 사용자',
          picture: 'https://example.com/p.png',
        },
      }),
    ).toBe(true);
    expect(await findUserByEmail(state.handle!, 'google.user@pentasecurity.com')).toMatchObject({
      googleSub: 'g-2',
      avatarUrl: 'https://example.com/p.png',
      createdVia: 'auto',
    });
  });

  it('jwt: 최초 발급 시 userId·role 을 싣고, 비활성·미존재면 null 로 세션을 끊는다', async () => {
    const config = await loadConfig(TEST_ENV);
    const jwt = config.callbacks!.jwt! as (
      params: unknown,
    ) => Promise<Record<string, unknown> | null>;
    const session = config.callbacks!.session! as (params: unknown) => unknown;

    const issued = await jwt({
      token: { email: 'Google.User@pentasecurity.com' },
      account: { provider: 'google' },
    });
    expect(issued).toMatchObject({ role: 'USER', name: '구글 사용자' });
    expect(typeof issued?.userId).toBe('string');

    expect(session({ session: { user: { name: 'x' } }, token: issued })).toMatchObject({
      user: { id: issued?.userId, role: 'USER' },
    });

    expect(await jwt({ token: { email: 'nobody@pentasecurity.com' }, account: {} })).toBeNull();
    expect(await jwt({ token: {} })).toBeNull();
  });
});
