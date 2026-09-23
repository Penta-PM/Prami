import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import type { Provider } from 'next-auth/providers';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';

import type { Env } from '@/env';

export const TEST_PROVIDER_ID = 'test';

export type TestAuthorize = (credentials: Partial<Record<string, unknown>>) => Promise<{
  id: string;
  email: string;
  name: string;
} | null>;

/** Google OAuth 클라이언트가 설정됐는지 (Q-01 후속: 발급 전에는 버튼을 비활성 표시) */
export function isGoogleConfigured(env: Pick<Env, 'AUTH_GOOGLE_ID' | 'AUTH_GOOGLE_SECRET'>) {
  return Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
}

/** 테스트 Credentials 는 AUTH_TEST_MODE=true 이고 production 이 아닐 때만 등록한다 (AC-07) */
export function isTestModeEnabled(env: Pick<Env, 'AUTH_TEST_MODE' | 'NODE_ENV'>): boolean {
  return env.AUTH_TEST_MODE && env.NODE_ENV !== 'production';
}

/** 길이와 무관하게 상수 시간으로 비교한다 */
export function passwordMatches(input: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(input), digest(expected));
}

export function buildProviders(env: Env, authorizeTest: TestAuthorize): Provider[] {
  const providers: Provider[] = [];
  if (isGoogleConfigured(env)) {
    providers.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        // hd 는 계정 선택 UX 용. 보안 경계는 서버의 도메인 검사(callbacks.ts)
        authorization: { params: { hd: env.ALLOWED_EMAIL_DOMAINS[0], prompt: 'select_account' } },
      }),
    );
  }
  if (isTestModeEnabled(env)) {
    providers.push(
      Credentials({
        id: TEST_PROVIDER_ID,
        name: '테스트 계정',
        credentials: { email: { label: '이메일' }, password: { label: '비밀번호' } },
        authorize: authorizeTest,
      }),
    );
  }
  return providers;
}
