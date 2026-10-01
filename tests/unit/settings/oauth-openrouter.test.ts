// @vitest-environment node
import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { queryRows } from '@/server/imports/sql-rows';

import { createTestDb, insertUser } from '../../helpers/pglite';
import { expectNoSecret } from '../../helpers/secret';

/**
 * AC-244 OpenRouter OAuth PKCE (PRAMI-002 §4.6.2, 플래그 on 테스트): start 302(S256·callback_url 출처), 콜백 검증(state·쿠키·세션 사용자),
 * 교환 성공(스텁) → oauth_pkce 행 봉투 암호화·쿠키 삭제·감사 settings.oauth.connect, 플래그 off → 404, 키가 로그·감사에 없음.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
  flag: true,
  logs: [] as string[],
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
  currentRequestId: async () => null,
}));
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return {
    ...actual,
    get env() {
      return {
        ...actual.env,
        LLM_OAUTH_OPENROUTER: state.flag,
        AUTH_SECRET: 'oauth-test-secret-not-for-production-000000',
        NEXT_PUBLIC_APP_URL: 'https://prami.example.com',
      };
    },
  };
});

const start = await import('@/app/api/settings/oauth/openrouter/start/route');
const callback = await import('@/app/api/settings/oauth/openrouter/callback/route');
const { invalidateSessionUser } = await import('@/server/auth/session-user');
const { withDecryptedSecret, saveCredential, deleteOwnCredential } =
  await import('@/server/llm/credentials/service');
const { keyringFromEnv } = await import('@/server/llm/credentials/keyring');
const { env } = await import('@/env');
const { vendorViews } = await import('@/server/llm/credentials/settings');

const EXCHANGED_KEY = 'sk-or-v1-test-EXCHANGED-0123456789abcdef0123';
let userA: string;
let userB: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  userA = (await insertUser(state.handle, { email: 'oauth-a@pentasecurity.com' })).id;
  userB = (await insertUser(state.handle, { email: 'oauth-b@pentasecurity.com' })).id;
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      state.logs.push(
        args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
      );
    });
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  state.flag = true;
  state.sessionUserId = userA;
  vi.unstubAllGlobals();
});

async function begin() {
  const response = await start.GET();
  const location = new URL(response.headers.get('location')!);
  const cookie = response.headers.get('set-cookie')!;
  return { response, location, cookie, value: cookie.split(';')[0]! };
}

function callbackRequest(query: string, cookie?: string) {
  return new Request(`https://prami.example.com/api/settings/oauth/openrouter/callback?${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

const rows = (userId: string) =>
  queryRows<{ auth_type: string }>(
    state.handle!.db,
    sql`select auth_type from user_llm_credentials where user_id = ${userId} and vendor = 'openrouter'`,
  );

describe('플래그 off (AC-244)', () => {
  it('start·callback 모두 404, 설정 화면 카드 미표시', async () => {
    state.flag = false;
    expect((await start.GET()).status).toBe(404);
    expect((await callback.GET(callbackRequest('state=x&code=y'))).status).toBe(404);
    expect(vendorViews({ oauthOpenRouter: false }).map((view) => view.id)).not.toContain(
      'openrouter',
    );
    const card = vendorViews({ oauthOpenRouter: true }).find((view) => view.id === 'openrouter');
    expect(card).toMatchObject({
      manualKeyEntry: false,
      connectHref: '/api/settings/oauth/openrouter/start',
    });
  });
});

describe('start (AC-244)', () => {
  it('302 → https://openrouter.ai/auth, S256 challenge, callback_url 은 앱 출처 + state, 암호화 HttpOnly 쿠키', async () => {
    const { response, location, cookie } = await begin();
    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe('https://openrouter.ai/auth');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const back = new URL(location.searchParams.get('callback_url')!);
    expect(back.origin).toBe('https://prami.example.com');
    expect(back.pathname).toBe('/api/settings/oauth/openrouter/callback');
    expect(back.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/Path=\/api\/settings\/oauth\/openrouter/);
    expect(cookie).toMatch(/Max-Age=600/);
    // 쿠키에는 state 가 평문으로 보이지 않는다 (암호화)
    expect(cookie).not.toContain(back.searchParams.get('state')!);
  });

  it('PRAMI-003 AC-345: key_label=Prami (<env>) — 한도·만료 파라미터는 PKCE auth URL 미지원이라 보내지 않는다', async () => {
    const { location } = await begin();
    expect(location.searchParams.get('key_label')).toBe('Prami (local)');
    for (const unsupported of ['limit', 'usage_limit_type', 'expires_at']) {
      expect(location.searchParams.has(unsupported)).toBe(false);
    }
  });

  it.each([
    [{ VERCEL_ENV: 'production' }, 'Prami (production)'],
    [{ VERCEL_ENV: 'preview' }, 'Prami (preview)'],
    [{ NODE_ENV: 'production', APP_ENV: 'production' }, 'Prami (production)'],
    [{}, 'Prami (local)'],
  ])('PRAMI-003 AC-345: 환경 %o → 라벨 %s', async (source, label) => {
    const { oauthEnvName, oauthKeyLabel } = await import('@/server/llm/oauth/key-label');
    expect(oauthKeyLabel(oauthEnvName(source))).toBe(label);
  });

  it('비로그인 → 401', async () => {
    state.sessionUserId = undefined;
    expect((await start.GET()).status).toBe(401);
  });
});

describe('callback (AC-244)', () => {
  it.each([
    ['state 불일치', (v: string) => callbackRequest('state=WRONGSTATEWRONGSTATEAA&code=c', v)],
    ['쿠키 없음', (_v: string, s: string) => callbackRequest(`state=${s}&code=c`)],
    ['변조된 쿠키', (v: string, s: string) => callbackRequest(`state=${s}&code=c`, `${v}x`)],
  ])('%s → 행 미생성, /settings?error=oauth, 교환 호출 없음', async (_label, build) => {
    const exchange = vi.fn();
    vi.stubGlobal('fetch', exchange);
    const { location, value } = await begin();
    const s = new URL(location.searchParams.get('callback_url')!).searchParams.get('state')!;
    const response = await callback.GET(build(value, s));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://prami.example.com/settings?error=oauth#llm',
    );
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(exchange).not.toHaveBeenCalled();
    expect(await rows(userA)).toEqual([]);
  });

  it('다른 세션 사용자(A 가 시작, B 가 콜백) → 거부', async () => {
    const { location, value } = await begin();
    const s = new URL(location.searchParams.get('callback_url')!).searchParams.get('state')!;
    state.sessionUserId = userB;
    invalidateSessionUser();
    const response = await callback.GET(callbackRequest(`state=${s}&code=c`, value));
    expect(response.headers.get('location')).toContain('error=oauth');
    expect(await rows(userB)).toEqual([]);
  });

  it('교환 성공(스텁) → oauth_pkce 행 암호화 저장, 쿠키 삭제, 감사 connect, 키는 로그·감사에 없음', async () => {
    const { location, value } = await begin();
    const challenge = location.searchParams.get('code_challenge')!;
    const s = new URL(location.searchParams.get('callback_url')!).searchParams.get('state')!;
    const exchange = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        code: string;
        code_verifier: string;
        code_challenge_method: string;
      };
      expect(body.code).toBe('AUTHCODE123');
      expect(body.code_challenge_method).toBe('S256');
      expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(challenge);
      return Response.json({ key: EXCHANGED_KEY, user_id: 'u' });
    });
    vi.stubGlobal('fetch', exchange);
    state.logs.length = 0;
    const response = await callback.GET(callbackRequest(`state=${s}&code=AUTHCODE123`, value));
    expect(response.headers.get('location')).toBe('https://prami.example.com/settings#llm');
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(exchange).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/auth/keys',
      expect.anything(),
    );
    expect(await rows(userA)).toEqual([{ auth_type: 'oauth_pkce' }]);
    const stored = await withDecryptedSecret(
      { handle: state.handle!, keys: keyringFromEnv(env) },
      userA,
      'openrouter',
      async (secret) => secret,
    );
    expect(stored).toBe(EXCHANGED_KEY);
    const audits = await queryRows<{ action: string; after: unknown }>(
      state.handle!.db,
      sql`select action, after from audit_logs where actor_user_id = ${userA} order by id`,
    );
    expect(audits.map((row) => row.action)).toContain('settings.oauth.connect');
    expect(audits.find((row) => row.action === 'settings.oauth.connect')!.after).toEqual({
      vendor: 'openrouter',
    });
    expectNoSecret(JSON.stringify(audits), EXCHANGED_KEY, '감사');
    expectNoSecret(state.logs.join('\n'), EXCHANGED_KEY, '로그');
    // PRAMI-003 AC-345: 콜백 응답(Location·Set-Cookie·본문)에도 교환 키 노출 0 (PRAMI-002 AC-204 기준)
    expectNoSecret(
      JSON.stringify([...response.headers.entries()]) + (await response.text()),
      EXCHANGED_KEY,
      '콜백 응답',
    );
  });

  it('OAuth 전용 벤더는 키 직접 저장 거부, 삭제하면 감사 disconnect', async () => {
    const ctx = {
      handle: state.handle!,
      actor: { id: userA, label: 'oauth-a' },
      meta: { ip: null, userAgent: 'vitest' },
      keys: keyringFromEnv(env),
      mode: 'fake' as const,
    };
    await expect(
      saveCredential(ctx, { vendor: 'openrouter', apiKey: EXCHANGED_KEY }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await deleteOwnCredential(ctx, { vendor: 'openrouter' });
    const [row] = await queryRows<{ after: unknown; before: unknown }>(
      state.handle!.db,
      sql`select before, after from audit_logs where action = 'settings.oauth.disconnect' and actor_user_id = ${userA}`,
    );
    expect(row).toEqual({ before: { vendor: 'openrouter' }, after: null });
  });
});

describe('state 1회 소비 (PR-C QA L-2 재현 → 회귀)', () => {
  const connectAudits = (userId: string) =>
    queryRows<{ n: number }>(
      state.handle!.db,
      sql`select count(*)::int as n from audit_logs where action = 'settings.oauth.connect' and actor_user_id = ${userId}`,
    );
  const credentialIds = (userId: string) =>
    queryRows<{ id: string }>(
      state.handle!.db,
      sql`select id from user_llm_credentials where user_id = ${userId} and vendor = 'openrouter'`,
    );

  async function flowFor(userId: string) {
    state.sessionUserId = userId;
    invalidateSessionUser();
    const { location, value } = await begin();
    const s = new URL(location.searchParams.get('callback_url')!).searchParams.get('state')!;
    return { value, s };
  }

  it('QA 재현: 같은 쿠키·state·code 로 콜백 재호출 → 거부, 교환 1회, 행 교체 없음, 감사 connect 1회', async () => {
    const { value, s } = await flowFor(userB);
    const exchange = vi.fn(async () => Response.json({ key: EXCHANGED_KEY }));
    vi.stubGlobal('fetch', exchange);
    const first = await callback.GET(callbackRequest(`state=${s}&code=QACODE`, value));
    expect(first.headers.get('location')).toBe('https://prami.example.com/settings#llm');
    const before = await credentialIds(userB);
    const replay = await callback.GET(callbackRequest(`state=${s}&code=QACODE`, value));
    expect(replay.headers.get('location')).toBe(
      'https://prami.example.com/settings?error=oauth#llm',
    );
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(await credentialIds(userB)).toEqual(before);
    expect(await connectAudits(userB)).toEqual([{ n: 1 }]);
    expect(state.logs.join('\n')).toContain('reused');
  });

  it('교환 실패 후 같은 state 로 재시도해도 거부 (교환 전에 소비)', async () => {
    const { value, s } = await flowFor(userB);
    const failing = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', failing);
    await callback.GET(callbackRequest(`state=${s}&code=C1`, value));
    const retry = vi.fn(async () => Response.json({ key: EXCHANGED_KEY }));
    vi.stubGlobal('fetch', retry);
    const again = await callback.GET(callbackRequest(`state=${s}&code=C1`, value));
    expect(again.headers.get('location')).toContain('error=oauth');
    expect(retry).not.toHaveBeenCalled();
  });

  it('동시 콜백 2개 → 원자적 소비로 하나만 교환', async () => {
    const { value, s } = await flowFor(userB);
    const exchange = vi.fn(async () => Response.json({ key: EXCHANGED_KEY }));
    vi.stubGlobal('fetch', exchange);
    const results = await Promise.all([
      callback.GET(callbackRequest(`state=${s}&code=P1`, value)),
      callback.GET(callbackRequest(`state=${s}&code=P1`, value)),
    ]);
    const locations = results.map((response) => response.headers.get('location'));
    expect(locations.filter((location) => location?.endsWith('/settings#llm'))).toHaveLength(1);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('저장은 SHA-256 해시만(원문 없음), 만료 행은 다음 소비 때 정리, 다른 사용자 키 공간은 분리', async () => {
    const { consumeOAuthState, stateHash } = await import('@/server/llm/oauth/state-store');
    const now = Date.now();
    await consumeOAuthState(state.handle!, {
      userId: userA,
      vendor: 'openrouter',
      state: 'EXPIRING-STATE-0000000000',
      expiresAt: now + 1_000,
      now,
    });
    const stored = await queryRows<{ state_hash: string }>(
      state.handle!.db,
      sql`select state_hash from oauth_flow_states where user_id = ${userA}`,
    );
    expect(stored.map((row) => row.state_hash)).toContain(stateHash('EXPIRING-STATE-0000000000'));
    expect(JSON.stringify(stored)).not.toContain('EXPIRING-STATE');
    // 같은 state 라도 다른 사용자 행과 충돌하지 않는다 (기본 키 user_id + state_hash)
    await expect(
      consumeOAuthState(state.handle!, {
        userId: userB,
        vendor: 'openrouter',
        state: 'EXPIRING-STATE-0000000000',
        expiresAt: now + 1_000,
        now,
      }),
    ).resolves.toBeUndefined();
    await consumeOAuthState(state.handle!, {
      userId: userA,
      vendor: 'openrouter',
      state: 'LATER-STATE-00000000000000',
      expiresAt: now + 600_000,
      now: now + 5_000,
    });
    const left = await queryRows<{ state_hash: string }>(
      state.handle!.db,
      sql`select state_hash from oauth_flow_states where expires_at < ${new Date(now + 5_000).toISOString()}`,
    );
    expect(left).toEqual([]);
  });
});
