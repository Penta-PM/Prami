import 'server-only';

import { getDbHandle } from '@/db';
import { env } from '@/env';
import { currentRequestMeta } from '@/server/audit/request-meta';
import type { SessionUser } from '@/server/auth/session-user';
import { logger } from '@/server/log';

import { keyringFromEnv } from '../credentials/keyring';
import { saveOAuthCredential } from '../credentials/service';
import {
  authorizeUrl,
  createPkce,
  exchangeCode,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  OAUTH_TTL_SECONDS,
  OAuthFlowError,
  openOAuthCookie,
  sealOAuthCookie,
  verifyCallback,
} from './openrouter';
import { oauthKeyLabel } from './key-label';
import { consumeOAuthState } from './state-store';

/**
 * OpenRouter OAuth 라우트 본문 (PRAMI-002 §4.6.2 ①②, AC-244). 라우트 파일은 권한 가드·플래그만, 흐름은 여기.
 * 실패는 원인 코드만 로그하고 `/settings?error=oauth#llm` 로 보낸다(벤더 메시지 미표시). 성공은 `/settings#llm`.
 */
export const OAUTH_GUARD = {
  permission: 'settings.self',
  auditAction: 'settings.oauth',
  target: OAUTH_COOKIE_PATH,
} as const;

export function oauthEnabled(): boolean {
  return env.LLM_OAUTH_OPENROUTER;
}

export function notFound(): Response {
  return new Response(null, { status: 404 });
}

function cookieHeader(value: string, maxAge: number): string {
  const secure = env.NODE_ENV === 'production' || env.NEXT_PUBLIC_APP_URL.startsWith('https:');
  return [
    `${OAUTH_COOKIE}=${value}`,
    `Path=${OAUTH_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function redirect(location: string, cookie: string): Response {
  return new Response(null, { status: 302, headers: { location, 'set-cookie': cookie } });
}

function readCookie(request: Request): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  const entry = header.split(/;\s*/).find((part) => part.startsWith(`${OAUTH_COOKIE}=`));
  return entry?.slice(OAUTH_COOKIE.length + 1);
}

/** ① 시작: PKCE 를 만들어 암호화 쿠키에 두고 OpenRouter 인증 화면으로 302 */
export function startFlow(user: SessionUser): Response {
  const session = createPkce();
  const exp = Date.now() + OAUTH_TTL_SECONDS * 1000;
  const cookie = sealOAuthCookie(
    { verifier: session.verifier, state: session.state, userId: user.id, exp },
    env.AUTH_SECRET,
  );
  return redirect(
    authorizeUrl(env.NEXT_PUBLIC_APP_URL, session, oauthKeyLabel()),
    cookieHeader(cookie, OAUTH_TTL_SECONDS),
  );
}

async function connect(user: SessionUser, apiKey: string): Promise<void> {
  const handle = await getDbHandle();
  await saveOAuthCredential(
    {
      handle,
      actor: { id: user.id, label: user.email },
      meta: await currentRequestMeta(),
      keys: keyringFromEnv(env),
      mode: env.LLM_VENDOR_MODE,
    },
    { vendor: 'openrouter', apiKey },
  );
}

/** ② 콜백: 쿠키·state·세션 사용자 검증 → state 1회 소비(교환 전) → 코드 교환 → 봉투 암호화 저장 → 쿠키 삭제 */
export async function finishFlow(
  request: Request,
  user: SessionUser,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const clear = cookieHeader('', 0);
  const settingsUrl = (query: string) =>
    new URL(`/settings${query}#llm`, env.NEXT_PUBLIC_APP_URL).toString();
  try {
    const cookie = openOAuthCookie(readCookie(request), env.AUTH_SECRET);
    const state = url.searchParams.get('state');
    verifyCallback(cookie, { state, userId: user.id, now: Date.now() });
    // 교환 전에 소비 — 재사용(같은 쿠키·state 재호출)은 여기서 거부되고, 교환이 실패해도 다시 쓸 수 없다 (QA L-2)
    await consumeOAuthState(await getDbHandle(), {
      userId: user.id,
      vendor: 'openrouter',
      state: state!,
      expiresAt: cookie.exp,
    });
    const code = url.searchParams.get('code');
    if (!code) throw new OAuthFlowError('exchange');
    await connect(user, await exchangeCode(code, cookie.verifier, fetchImpl));
    return redirect(settingsUrl(''), clear);
  } catch (error) {
    const code = error instanceof OAuthFlowError ? error.code : 'store';
    logger.warn('settings.oauth_failed', { vendor: 'openrouter', code });
    return redirect(settingsUrl('?error=oauth'), clear);
  }
}
