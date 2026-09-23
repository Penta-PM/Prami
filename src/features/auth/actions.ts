'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';

import { signIn, signOut } from '@/server/auth/auth';
import { TEST_PROVIDER_ID } from '@/server/auth/providers';

import { safeCallbackUrl } from './callback-url';

/** 로그인 폼 Server Actions. Auth.js 가 성공 시 NEXT_REDIRECT 를 던지므로 AuthError 만 잡는다 */

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const redirectTo = safeCallbackUrl(formData.get('callbackUrl'));
  await signIn('google', { redirectTo });
}

export async function signInWithTestAccount(formData: FormData): Promise<void> {
  const redirectTo = safeCallbackUrl(formData.get('callbackUrl'));
  try {
    await signIn(TEST_PROVIDER_ID, {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const code = 'code' in error && typeof error.code === 'string' ? error.code : error.type;
      const params = new URLSearchParams({ error: code, callbackUrl: redirectTo });
      redirect(`/login?${params.toString()}`);
    }
    throw error;
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
