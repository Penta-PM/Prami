import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { z } from 'zod';

/**
 * OpenRouter OAuth PKCE (PRAMI-002 §4.6.2, PR-C, AC-244) — 공식 문서(2026-09-30):
 * https://openrouter.ai/docs/guides/overview/auth/oauth — `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256`
 * → `POST https://openrouter.ai/api/v1/auth/keys` `{ code, code_verifier, code_challenge_method }` → `{ key }`.
 * 문서에 `state` 파라미터가 없어(Q-12) `callback_url` 쿼리에 state 를 싣고, 콜백에서 암호화 쿠키의 state 와 대조한다.
 * code_verifier·state·세션 사용자 id 는 AUTH_SECRET 파생 키(HKDF)로 AES-256-GCM 암호화한 HttpOnly 쿠키(10분)에만 둔다.
 * 교환 응답의 키는 이 모듈 반환값 → 봉투 암호화(PR-A) 저장으로만 흐른다 — 로그·감사·응답에 남기지 않는다.
 */
export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys';
export const OAUTH_COOKIE = 'prami_oauth_openrouter';
export const OAUTH_COOKIE_PATH = '/api/settings/oauth/openrouter';
export const OAUTH_TTL_SECONDS = 600;
const EXCHANGE_TIMEOUT_MS = 10_000;

export class OAuthFlowError extends Error {
  constructor(
    readonly code: 'state' | 'cookie' | 'user' | 'expired' | 'reused' | 'exchange' | 'config',
  ) {
    super(`oauth:${code}`);
    this.name = 'OAuthFlowError';
  }
}

const b64url = (buffer: Buffer) => buffer.toString('base64url');

export type PkceSession = { verifier: string; challenge: string; state: string };

export function createPkce(): PkceSession {
  const verifier = b64url(randomBytes(32));
  return {
    verifier,
    challenge: b64url(createHash('sha256').update(verifier).digest()),
    state: b64url(randomBytes(16)),
  };
}

function cookieKey(authSecret: string | undefined): Buffer {
  if (!authSecret) throw new OAuthFlowError('config');
  return Buffer.from(hkdfSync('sha256', authSecret, 'prami-oauth-openrouter', 'cookie-v1', 32));
}

const CookieSchema = z.object({
  verifier: z.string().min(43),
  state: z.string().min(16),
  userId: z.string().min(1),
  exp: z.number().int(),
});
export type OAuthCookie = z.infer<typeof CookieSchema>;

export function sealOAuthCookie(value: OAuthCookie, authSecret: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cookieKey(authSecret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return b64url(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

export function openOAuthCookie(
  token: string | undefined,
  authSecret: string | undefined,
): OAuthCookie {
  if (!token) throw new OAuthFlowError('cookie');
  try {
    const raw = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', cookieKey(authSecret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(
      'utf8',
    );
    return CookieSchema.parse(JSON.parse(json));
  } catch (error) {
    if (error instanceof OAuthFlowError) throw error;
    throw new OAuthFlowError('cookie');
  }
}

function sameState(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 콜백 검증: 쿠키 무결성·만료·state 일치(상수 시간 비교)·같은 세션 사용자 */
export function verifyCallback(
  cookie: OAuthCookie,
  input: { state: string | null; userId: string; now: number },
): void {
  if (input.now > cookie.exp) throw new OAuthFlowError('expired');
  if (!input.state || !sameState(input.state, cookie.state)) throw new OAuthFlowError('state');
  if (input.userId !== cookie.userId) throw new OAuthFlowError('user');
}

export function callbackUrl(appUrl: string, state: string): string {
  const url = new URL(`${OAUTH_COOKIE_PATH}/callback`, appUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * 인증 화면 URL. `key_label` 은 문서화된 auth URL 파라미터다(PRAMI-003 §4.4.3, 2026-10-02 확인).
 * 한도(`limit`·`usage_limit_type`)·만료(`expires_at`)는 auth URL 이 아니라 관리 키가 필요한 서버 API
 * (`POST /api/v1/auth/keys/code`)에만 있어 이 흐름에서는 보내지 않는다 — 한도는 사용자가 OpenRouter 대시보드에서 설정한다.
 */
export function authorizeUrl(appUrl: string, session: PkceSession, keyLabel: string): string {
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set('callback_url', callbackUrl(appUrl, session.state));
  url.searchParams.set('code_challenge', session.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('key_label', keyLabel.slice(0, KEY_LABEL_MAX));
  return url.toString();
}

/** OpenRouter `key_label` 최대 길이 (API 레퍼런스) */
const KEY_LABEL_MAX = 100;

const ExchangeResponse = z.object({ key: z.string().min(16).max(256) });

/** 코드 → 사용자 소유 API 키. 실패는 코드만(벤더 본문·키 미기록) */
export async function exchangeCode(
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(OPENROUTER_KEYS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
  } catch {
    throw new OAuthFlowError('exchange');
  }
  if (!response.ok) throw new OAuthFlowError('exchange');
  const parsed = ExchangeResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new OAuthFlowError('exchange');
  return parsed.data.key;
}
