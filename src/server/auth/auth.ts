import 'server-only';

import { eq } from 'drizzle-orm';
import NextAuth, { CredentialsSignin } from 'next-auth';
import { headers } from 'next/headers';

import { getDb, getDbHandle } from '@/db';
import { users } from '@/db/schema';
import { env } from '@/env';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { rateLimiters } from '@/server/rate-limit';

import { authConfig } from './auth.config';
import { normalizeEmail, resolveSignIn, type SignInInput, type SignInPolicy } from './callbacks';
import { buildProviders, passwordMatches, type TestAuthorize } from './providers';
import { loadSessionUser } from './session-user';
import { guardTestLogin } from './test-mode-guard';

export const signInPolicy: SignInPolicy = {
  allowedDomains: env.ALLOWED_EMAIL_DOMAINS,
  adminEmails: env.ADMIN_EMAILS,
  autoProvision: env.AUTH_AUTO_PROVISION,
  // PRAMI-003 §4.9.3 L3: 운영·preview 에서는 fixture 접두 이메일 로그인 거부
  rejectFixtureAccounts: Boolean(env.VERCEL_ENV),
};

/** 테스트 로그인 거부 사유를 /login?error=CredentialsSignin&code=<사유> 로 전달한다 */
class TestSignInError extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

async function signInWithPolicy(input: Omit<SignInInput, 'meta'>) {
  const meta = await currentRequestMeta();
  return resolveSignIn(await getDbHandle(), { ...input, meta }, signInPolicy);
}

/** 요청 Host: Auth.js 가 넘긴 Request 우선, 없으면 현재 요청 헤더 (Server Action 경로) */
async function requestHost(request?: Request): Promise<string | null> {
  const fromRequest = request?.headers.get('host');
  if (fromRequest) return fromRequest;
  try {
    return (await headers()).get('host');
  } catch {
    return null;
  }
}

/**
 * 테스트 Credentials: Host 허용 목록·시도 횟수 검사(§4.8 r5 ①) → 이메일 + 고정 AUTH_TEST_PASSWORD → Google 과 동일 판정.
 * Host 가 목록 밖이면 비밀번호를 보기 전에 거부하고 감사 auth.denied_test_mode 를 남긴다 (세션 미발급).
 */
const authorizeTest: TestAuthorize = async (credentials, request) => {
  const email = typeof credentials.email === 'string' ? credentials.email : '';
  const password = typeof credentials.password === 'string' ? credentials.password : '';
  const decision = await guardTestLogin({
    db: await getDb(),
    host: await requestHost(request),
    email,
    allowedHosts: env.AUTH_TEST_ALLOWED_HOSTS,
    limiter: rateLimiters.testLogin,
    meta: await currentRequestMeta(),
  });
  if (decision !== 'ok') throw new TestSignInError(decision);
  if (!email || !env.AUTH_TEST_PASSWORD || !passwordMatches(password, env.AUTH_TEST_PASSWORD)) {
    throw new TestSignInError('credentials');
  }
  const outcome = await signInWithPolicy({ email, emailVerified: true });
  if (!outcome.ok) throw new TestSignInError(outcome.reason);
  return { id: outcome.user.id, email: outcome.user.email, name: outcome.user.name };
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: buildProviders(env, authorizeTest),
  callbacks: {
    ...authConfig.callbacks,
    /** Google 로그인 판정 (도메인·부트스트랩·자동 생성·비활성). 테스트 로그인은 authorize 에서 이미 판정됨 */
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true;
      const outcome = await signInWithPolicy({
        email: profile?.email ?? '',
        emailVerified: profile?.email_verified === true,
        name: profile?.name,
        googleSub: account.providerAccountId,
        avatarUrl: typeof profile?.picture === 'string' ? profile.picture : null,
      });
      return outcome.ok ? true : `/login?error=${outcome.reason}`;
    },
    /**
     * 최초 발급 시 DB 사용자 id·역할을 싣고, 이후 매 요청 DB(60초 캐시)로 활성 여부·역할을 다시 확인한다.
     * 비활성·삭제 사용자는 null 을 돌려 세션을 끊는다 (§4.6.1).
     */
    async jwt({ token, account }) {
      const db = await getDb();
      if (account && token.email) {
        const [row] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, normalizeEmail(token.email)))
          .limit(1);
        if (!row) return null;
        token.userId = row.id;
      }
      if (typeof token.userId !== 'string') return null;
      const current = await loadSessionUser(db, token.userId);
      if (!current) return null;
      token.role = current.role;
      token.name = current.name;
      return token;
    },
  },
});
