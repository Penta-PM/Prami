// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '@/env';
import { runChat } from '@/server/chat/graph/run';
import { chatGraph, chatStatus, createChatRuntime } from '@/server/chat/graph/runtime';
import { queryRows } from '@/server/imports/sql-rows';
import { keyringFromEnv } from '@/server/llm/credentials/keyring';
import {
  deleteOwnCredential,
  saveCredential,
  saveOAuthCredential,
  verifyOwnCredential,
  VENDOR_DISABLED_MESSAGE,
  type CredentialsContext,
} from '@/server/llm/credentials/service';
import { getMySettings, updateChatDefaults } from '@/server/llm/credentials/settings';

import { setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { insertUser } from '../../helpers/pglite';
import { makeFakeKey } from '../../helpers/secret';

/**
 * PR-C QA L-3 재현 → 회귀: OpenRouter 플래그를 켰다가 끈 뒤 남은 OAuth 자격 증명은
 * ① 챗봇에서 쓰지 않고(복호화·호출 없음) 명확한 안내 ② 검증·기본값 지정 불가 ③ 설정 카드가 보이고 삭제(파기)는 된다.
 */
let ctx: ChatTestDb;
const FLAG_OFF = { ...env, LLM_OAUTH_OPENROUTER: false };
const FLAG_ON = { ...env, LLM_OAUTH_OPENROUTER: true };

const credentialsCtx = (userId: string, oauthOpenRouter: boolean): CredentialsContext => ({
  handle: ctx.handle,
  actor: { id: userId, label: 'flag-test' },
  meta: { ip: null, userAgent: 'vitest' },
  keys: keyringFromEnv(env),
  mode: 'fake',
  flags: { oauthOpenRouter },
});

const ask = (userId: string, chatEnv: typeof env) =>
  runChat(
    chatGraph,
    { text: 'Wapples-500 가격', truncated: false, history: [], actor: { userId, role: 'USER' } },
    createChatRuntime({ db: ctx.handle.db, userId, env: chatEnv }),
  );

/** 플래그가 켜져 있을 때 연결해 둔 OpenRouter OAuth 행 + 기본 벤더 openrouter */
async function connectedUser(email: string): Promise<string> {
  const userId = (await insertUser(ctx.handle, { email })).id;
  await saveOAuthCredential(credentialsCtx(userId, true), {
    vendor: 'openrouter',
    apiKey: makeFakeKey('fake-valid-'),
  });
  await ctx.handle.db.execute(
    sql`insert into user_settings (user_id, chat_default_vendor) values (${userId}, 'openrouter')`,
  );
  return userId;
}

beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);
afterAll(async () => {
  await ctx.handle.close();
});

describe('QA L-3 플래그 off 후 남은 OpenRouter 자격 증명', () => {
  it('재현 대조: 플래그 on 이면 OpenRouter 로 LLM 경로', async () => {
    const userId = await connectedUser('flag-on@pentasecurity.com');
    expect(await ask(userId, FLAG_ON)).toMatchObject({
      mode: 'llm',
      llm: { status: 'ready', vendor: 'openrouter' },
    });
  });

  it('플래그 off: 챗봇은 OpenRouter 키를 쓰지 않고 규칙 답 + "연결 해제" 안내 (상태 API 도 같음)', async () => {
    const userId = await connectedUser('flag-off@pentasecurity.com');
    const reply = await ask(userId, FLAG_OFF);
    expect(reply.mode).not.toBe('llm');
    expect(reply.llm).toMatchObject({ status: 'missing', vendor: null });
    expect(reply.setup?.message).toContain('OpenRouter 연결은 현재 챗봇에서 사용할 수 없습니다');
    expect(reply.setup?.message).toContain('연결을 해제');
    expect(reply.reply).not.toContain('[fake LLM]');
    const status = await chatStatus({ db: ctx.handle.db, userId, env: FLAG_OFF });
    expect(status.llm).toMatchObject({ status: 'missing', vendor: null });
    expect('setup' in status ? status.setup?.message : undefined).toContain('OpenRouter');
  });

  it('플래그 off + 다른 벤더 정상 키: 기본값이 openrouter 여도 켜진 벤더(Anthropic)를 쓴다', async () => {
    const userId = await connectedUser('flag-off-mixed@pentasecurity.com');
    await saveCredential(credentialsCtx(userId, false), {
      vendor: 'anthropic',
      apiKey: makeFakeKey('fake-valid-'),
    });
    expect(await ask(userId, FLAG_OFF)).toMatchObject({
      mode: 'llm',
      llm: { status: 'ready', vendor: 'anthropic' },
    });
  });

  it('플래그 off: 검증·기본값 지정은 VALIDATION(안내 문구), 삭제는 되고 감사 disconnect', async () => {
    const userId = await connectedUser('flag-off-delete@pentasecurity.com');
    const off = credentialsCtx(userId, false);
    await expect(verifyOwnCredential(off, { vendor: 'openrouter' })).rejects.toMatchObject({
      code: 'VALIDATION',
      message: VENDOR_DISABLED_MESSAGE,
    });
    await expect(
      updateChatDefaults(off, { vendor: 'openrouter', model: 'anthropic/claude-sonnet-5.5' }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: VENDOR_DISABLED_MESSAGE });
    await deleteOwnCredential(off, { vendor: 'openrouter' });
    const left = await queryRows<{ n: number }>(
      ctx.handle.db,
      sql`select count(*)::int as n from user_llm_credentials where user_id = ${userId}`,
    );
    expect(left).toEqual([{ n: 0 }]);
    const audits = await queryRows<{ action: string }>(
      ctx.handle.db,
      sql`select action from audit_logs where actor_user_id = ${userId} and action = 'settings.oauth.disconnect'`,
    );
    expect(audits).toHaveLength(1);
  });

  it('플래그 off 설정 화면 데이터: 키가 있으면 OpenRouter 카드(disabled, 연결 경로 없음), 없으면 카드 없음', async () => {
    const owner = await connectedUser('flag-off-view@pentasecurity.com');
    const view = (userId: string) =>
      getMySettings({
        db: ctx.handle.db,
        userId,
        keys: keyringFromEnv(env),
        mode: 'fake',
        testMode: true,
        flags: { oauthOpenRouter: false },
      });
    const openrouter = (await view(owner)).vendors.find((vendor) => vendor.id === 'openrouter');
    expect(openrouter).toMatchObject({ disabled: true, connectHref: null, manualKeyEntry: false });
    const stranger = (await insertUser(ctx.handle, { email: 'flag-off-none@pentasecurity.com' }))
      .id;
    const vendors = (await view(stranger)).vendors.map((vendor) => vendor.id);
    expect(vendors).toEqual(['anthropic', 'openai', 'google']);
  });
});
