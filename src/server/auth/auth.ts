import 'server-only';

import { eq } from 'drizzle-orm';
import NextAuth, { CredentialsSignin } from 'next-auth';

import { getDb, getDbHandle } from '@/db';
import { users } from '@/db/schema';
import { env } from '@/env';
import { currentRequestMeta } from '@/server/audit/request-meta';

import { authConfig } from './auth.config';
import { normalizeEmail, resolveSignIn, type SignInInput, type SignInPolicy } from './callbacks';
import { buildProviders, passwordMatches, type TestAuthorize } from './providers';
import { loadSessionUser } from './session-user';

export const signInPolicy: SignInPolicy = {
  allowedDomains: env.ALLOWED_EMAIL_DOMAINS,
  adminEmails: env.ADMIN_EMAILS,
  autoProvision: env.AUTH_AUTO_PROVISION,
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

/** 테스트 Credentials: 이메일 + 고정 AUTH_TEST_PASSWORD, 이후 판정은 Google 과 동일 규칙 */
const authorizeTest: TestAuthorize = async (credentials) => {
  const email = typeof credentials.email === 'string' ? credentials.email : '';
  const password = typeof credentials.password === 'string' ? credentials.password : '';
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
