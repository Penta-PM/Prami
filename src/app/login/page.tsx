import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';

import { env } from '@/env';
import { signInWithGoogle, signInWithTestAccount } from '@/features/auth/actions';
import { loginErrorMessage, safeCallbackUrl } from '@/features/auth/callback-url';
import { GoogleButton } from '@/features/auth/GoogleButton';
import { TestLoginForm } from '@/features/auth/TestLoginForm';
import { TestModeBanner } from '@/features/auth/TestModeBanner';
import { SEED_USERS } from '@/db/seed';
import { auth } from '@/server/auth/auth';
import { isGoogleConfigured, isTestModeEnabled } from '@/server/auth/providers';

export const metadata: Metadata = { title: '로그인' };

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** 로그인 (§4.6.1): Google 계정 로그인, AUTH_TEST_MODE 에서만 테스트 계정 로그인 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(first(params.callbackUrl));
  const session = await auth();
  if (session?.user?.id) redirect(callbackUrl);

  const error = loginErrorMessage(
    first(params.code) ?? first(params.error),
    env.ALLOWED_EMAIL_DOMAINS,
  );
  const googleReady = isGoogleConfigured(env);
  const testMode = isTestModeEnabled(env);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-page px-4 py-12">
      <section
        aria-labelledby="login-title"
        className="flex w-full max-w-[400px] flex-col gap-6 rounded-2xl bg-surface-card p-9 shadow-(--shadow-elevated)"
      >
        {testMode ? <TestModeBanner /> : null}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2.5">
            <Image src="/logo-prami-mark.png" alt="" width={34} height={31} priority />
            <span className="text-text-primary [font:var(--text-wordmark)]">Prami</span>
          </div>
          <h1 id="login-title" className="m-0 [font:var(--text-h2)]">
            가격정책 통합 관리
          </h1>
          <p className="m-0 text-[14px] text-text-tertiary">
            회사 Google 계정({env.ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(', ')})으로
            로그인하세요.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="m-0 rounded-lg bg-surface-danger px-3.5 py-3 text-[14px] text-text-danger"
          >
            {error}
          </p>
        ) : null}

        <form action={signInWithGoogle}>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <GoogleButton disabled={!googleReady} />
          {googleReady ? null : (
            <p className="mt-2 mb-0 text-center text-[11px] text-text-tertiary">
              Google OAuth 클라이언트가 아직 설정되지 않았습니다 (AUTH_GOOGLE_ID/SECRET).
            </p>
          )}
        </form>

        {testMode ? (
          <TestLoginForm
            action={signInWithTestAccount}
            callbackUrl={callbackUrl}
            presets={SEED_USERS.map((user) => ({ email: user.email, label: user.name }))}
          />
        ) : null}
      </section>
    </main>
  );
}
