// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { env } from '@/env';
import { chatStatus } from '@/server/chat/graph/runtime';
import { queryRows } from '@/server/imports/sql-rows';
import { isCredentialExpired } from '@/server/llm/credentials/expiry';
import { keyringFromEnv } from '@/server/llm/credentials/keyring';
import {
  deleteOwnCredential,
  saveOAuthCredential,
  verifyOwnCredential,
  type CredentialsContext,
} from '@/server/llm/credentials/service';
import { getMySettings } from '@/server/llm/credentials/settings';

import { setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { insertUser } from '../../helpers/pglite';
import { makeFakeKey } from '../../helpers/secret';

/**
 * PRAMI-003 PR-3 — OpenRouter OAuth 자격 증명 만료(AC-346, 0007 `expires_at`)와 연결 해제(AC-347).
 * 만료는 PKCE 흐름에서 지정할 수 없어(기본 NULL) 테스트는 행을 직접 갱신해 주입한다.
 */
let ctx: ChatTestDb;
const FLAG_ON = { ...env, LLM_OAUTH_OPENROUTER: true };

const credentialsCtx = (userId: string, oauthOpenRouter = true): CredentialsContext => ({
  handle: ctx.handle,
  actor: { id: userId, label: 'expiry-test' },
  meta: { ip: null, userAgent: 'vitest' },
  keys: keyringFromEnv(env),
  mode: 'fake',
  flags: { oauthOpenRouter },
});

async function connectedUser(email: string, expiresAt: Date | null): Promise<string> {
  const userId = (await insertUser(ctx.handle, { email })).id;
  await saveOAuthCredential(credentialsCtx(userId), {
    vendor: 'openrouter',
    apiKey: makeFakeKey('fake-valid-'),
  });
  await ctx.handle.db.execute(
    sql`update user_llm_credentials set expires_at = ${expiresAt?.toISOString() ?? null}
        where user_id = ${userId} and vendor = 'openrouter'`,
  );
  return userId;
}

const HOUR = 60 * 60 * 1000;

/** chatStatus 응답 (setup 은 설정이 필요할 때만 있다) */
const statusOf = async (userId: string) =>
  (await chatStatus({ db: ctx.handle.db, userId, env: FLAG_ON })) as Awaited<
    ReturnType<typeof chatStatus>
  > & { setup?: { status: string; message: string; href: string } };

beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});

describe('isCredentialExpired', () => {
  it('NULL = 비만료, 미래 = 정상, 지금·과거 = 만료', () => {
    const now = Date.parse('2026-10-02T00:00:00Z');
    expect(isCredentialExpired({ expiresAt: null }, now)).toBe(false);
    expect(isCredentialExpired({ expiresAt: new Date(now + 1) }, now)).toBe(false);
    expect(isCredentialExpired({ expiresAt: new Date(now) }, now)).toBe(true);
    expect(isCredentialExpired({ expiresAt: new Date(now - 1) }, now)).toBe(true);
  });

  it('0007: 새 OAuth 연결의 expires_at 기본값은 NULL', async () => {
    const userId = (await insertUser(ctx.handle, { email: 'expiry-default@pentasecurity.com' })).id;
    await saveOAuthCredential(credentialsCtx(userId), {
      vendor: 'openrouter',
      apiKey: makeFakeKey('fake-valid-'),
    });
    const [row] = await queryRows<{ expires_at: unknown }>(
      ctx.handle.db,
      sql`select expires_at from user_llm_credentials where user_id = ${userId}`,
    );
    expect(row).toEqual({ expires_at: null });
  });
});

describe('AC-346 만료된 OpenRouter 자격 증명', () => {
  it('과거 expires_at → 챗봇 setup.status=invalid + 만료 안내(다시 연결), 설정 카드 status=expired', async () => {
    const userId = await connectedUser('expired@pentasecurity.com', new Date(Date.now() - HOUR));

    const status = await statusOf(userId);
    expect(status.llm).toMatchObject({ status: 'invalid', vendor: 'openrouter' });
    expect(status.setup).toMatchObject({ status: 'invalid', href: '/settings#llm' });
    expect(status.setup?.message).toContain('OpenRouter 연결이 만료되었습니다 — 다시 연결하세요');

    const settings = await getMySettings({
      db: ctx.handle.db,
      userId,
      keys: keyringFromEnv(env),
      mode: 'fake',
      testMode: false,
      flags: { oauthOpenRouter: true },
    });
    expect(settings.credentials.find((entry) => entry.vendor === 'openrouter')?.status).toBe(
      'expired',
    );
  });

  it('과거 expires_at → [검증]은 벤더 호출 없이 invalid·code=expired, 감사 result=error code=expired', async () => {
    const userId = await connectedUser(
      'expired-verify@pentasecurity.com',
      new Date(Date.now() - 1),
    );
    const vendorCall = vi.fn();
    vi.stubGlobal('fetch', vendorCall);
    try {
      const view = await verifyOwnCredential(credentialsCtx(userId), { vendor: 'openrouter' });
      expect(view).toMatchObject({ status: 'expired', lastErrorCode: 'expired' });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(vendorCall).not.toHaveBeenCalled();
    const [audit] = await queryRows<{ result: string; after: Record<string, unknown> }>(
      ctx.handle.db,
      sql`select result, after from audit_logs
          where action = 'settings.llm_credential.verify' and actor_user_id = ${userId}`,
    );
    expect(audit).toMatchObject({
      result: 'error',
      after: { vendor: 'openrouter', status: 'invalid', outcome: 'invalid', code: 'expired' },
    });
  });

  it.each([
    ['미래 expires_at', new Date(Date.now() + HOUR)],
    ['NULL(비만료)', null],
  ])('%s → 정상(ready), 카드 status 는 만료 아님', async (_label, expiresAt) => {
    const userId = await connectedUser(
      `not-expired-${expiresAt ? 'future' : 'null'}@pentasecurity.com`,
      expiresAt,
    );
    const status = await statusOf(userId);
    expect(status.llm.status).toBe('ready');
    expect(status.setup).toBeUndefined();
    const view = await verifyOwnCredential(credentialsCtx(userId), { vendor: 'openrouter' });
    expect(view.status).not.toBe('expired');
    expect(view.lastErrorCode).not.toBe('expired');
  });
});

describe('AC-347 연결 해제', () => {
  it.each([
    ['플래그 on', true],
    ['플래그 off (PRAMI-002 AC-244 ⑥ 회귀)', false],
  ])('%s: 삭제 → 행 0, 감사 settings.oauth.disconnect, 카드에 키 라벨', async (_label, flag) => {
    const userId = await connectedUser(`disconnect-${flag}@pentasecurity.com`, null);

    await deleteOwnCredential(credentialsCtx(userId, flag), { vendor: 'openrouter' });

    const rows = await queryRows<{ n: number }>(
      ctx.handle.db,
      sql`select count(*)::int as n from user_llm_credentials where user_id = ${userId}`,
    );
    expect(rows).toEqual([{ n: 0 }]);
    const audits = await queryRows<{ action: string }>(
      ctx.handle.db,
      sql`select action from audit_logs where actor_user_id = ${userId} order by id`,
    );
    expect(audits.map((row) => row.action)).toContain('settings.oauth.disconnect');
    // 해제 후에도 카드(플래그 on) 또는 남은 행이 없으니 카드 없음(플래그 off) — 라벨은 벤더 뷰가 갖는다
    const settings = await getMySettings({
      db: ctx.handle.db,
      userId,
      keys: keyringFromEnv(env),
      mode: 'fake',
      testMode: false,
      flags: { oauthOpenRouter: flag },
    });
    const card = settings.vendors.find((vendor) => vendor.id === 'openrouter');
    if (flag) expect(card?.oauthKeyLabel).toBe('Prami (local)');
    else expect(card).toBeUndefined();
  });
});
