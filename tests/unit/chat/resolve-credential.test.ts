// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '@/env';
import { runChat } from '@/server/chat/graph/run';
import { chatGraph, createChatRuntime, chatStatus } from '@/server/chat/graph/runtime';
import { queryRows } from '@/server/imports/sql-rows';
import { resolveChatCredential } from '@/server/llm/credentials/chat';
import { keyringFromEnv } from '@/server/llm/credentials/keyring';
import { saveCredential, type CredentialsContext } from '@/server/llm/credentials/service';
import { updateChatDefaults } from '@/server/llm/credentials/settings';

import { makeFakeKey } from '../../helpers/secret';
import { setupChatDb, type ChatTestDb } from '../../helpers/chat';
import { insertUser } from '../../helpers/pglite';

/**
 * 실제 자격 증명 서비스 + fake 벤더(LLM_VENDOR_MODE=fake)로 그래프 전 경로 (PRAMI-002 §4.3.2 resolveCredential·§4.9):
 * AC-222 저장 직후 다음 질문부터 LLM 경로(캐시 없음), AC-223 ① 채팅 401 → DB invalid, ④ 404 → model_not_found,
 * **AC-223 ⑧ (r3) 기본 벤더 행이 무결성 실패면 unreadable 안내 + 규칙 답, 다른 벤더로 조용히 전환하지 않음**, last_used_at 1분 규칙.
 */
let ctx: ChatTestDb;

const credentialsCtx = (userId: string): CredentialsContext => ({
  handle: ctx.handle,
  actor: { id: userId, label: 'chat-test' },
  meta: { ip: null, userAgent: 'vitest' },
  keys: keyringFromEnv(env),
  mode: 'fake',
});

const question = (userId: string, text = 'Wapples-500 가격') =>
  runChat(
    chatGraph,
    { text, truncated: false, history: [], actor: { userId, role: 'USER' } },
    createChatRuntime({ db: ctx.handle.db, userId, env }),
  );

const lastUsed = async (userId: string) =>
  (
    await queryRows<{ last_used_at: string | null }>(
      ctx.handle.db,
      sql`select last_used_at from user_llm_credentials where user_id = ${userId} and vendor = 'anthropic'`,
    )
  )[0]?.last_used_at;

beforeAll(async () => {
  ctx = await setupChatDb();
}, 120_000);

afterAll(async () => {
  await ctx.handle.close();
});

describe('저장 직후 LLM 경로 (AC-222)', () => {
  it('키 없음 → rule+missing, fake-valid 저장 → 다음 질문부터 mode=llm·ready, last_used_at 은 1분 안 재갱신 생략', async () => {
    const userId = (await insertUser(ctx.handle, { email: 'rc1@pentasecurity.com' })).id;
    expect((await question(userId)).setup?.status).toBe('missing');
    expect((await chatStatus({ db: ctx.handle.db, userId, env })).llm.status).toBe('missing');
    await saveCredential(credentialsCtx(userId), {
      vendor: 'anthropic',
      apiKey: makeFakeKey('fake-valid-'),
    });
    const reply = await question(userId);
    expect(reply).toMatchObject({
      mode: 'llm',
      llm: { status: 'ready', vendor: 'anthropic', model: 'claude-opus-5-5' },
    });
    expect(reply.reply).toContain('[fake LLM] 조회 결과');
    expect(reply.setup).toBeUndefined();
    const first = await lastUsed(userId);
    expect(first).not.toBeNull();
    await question(userId);
    expect(await lastUsed(userId)).toEqual(first);
    expect((await chatStatus({ db: ctx.handle.db, userId, env })).llm.status).toBe('ready');
  });
});

describe('채팅 시점 벤더 오류 (AC-223 ①④)', () => {
  it('검증은 통과했지만 채팅이 401 → setup invalid + 규칙 답 + DB 상태 invalid', async () => {
    const userId = (await insertUser(ctx.handle, { email: 'rc2@pentasecurity.com' })).id;
    await saveCredential(credentialsCtx(userId), {
      vendor: 'anthropic',
      apiKey: makeFakeKey('fake-401-'),
    });
    // 검증 시점엔 무효로 저장되므로, "그 뒤 채팅에서 401" 상황을 만들려고 상태만 valid 로 되돌린다
    await ctx.handle.db.execute(
      sql`update user_llm_credentials set status = 'valid' where user_id = ${userId}`,
    );
    const reply = await question(userId);
    expect(reply).toMatchObject({ mode: 'rule', setup: { status: 'invalid' } });
    const [row] = await queryRows<{ status: string }>(
      ctx.handle.db,
      sql`select status from user_llm_credentials where user_id = ${userId}`,
    );
    expect(row!.status).toBe('invalid');
    expect(JSON.stringify(reply)).not.toContain('FAKE-VENDOR-MESSAGE');
  });

  it('fake-404- (검증 정상, 채팅 404) → model_not_found 문구에 모델 라벨', async () => {
    const userId = (await insertUser(ctx.handle, { email: 'rc3@pentasecurity.com' })).id;
    await saveCredential(credentialsCtx(userId), {
      vendor: 'anthropic',
      apiKey: makeFakeKey('fake-404-'),
    });
    const reply = await question(userId);
    expect(reply.setup).toMatchObject({ status: 'model_not_found' });
    expect(reply.setup!.message).toContain('Claude Opus 5.5');
  });
});

describe('무결성 실패 기본 벤더 (AC-223 ⑧, r3)', () => {
  it('기본 벤더 행 변조 → unreadable 안내 + 규칙 답, 다른 정상 벤더로 조용히 전환하지 않음', async () => {
    const userId = (await insertUser(ctx.handle, { email: 'rc4@pentasecurity.com' })).id;
    const creds = credentialsCtx(userId);
    await saveCredential(creds, { vendor: 'anthropic', apiKey: makeFakeKey('fake-valid-') });
    await saveCredential(creds, { vendor: 'openai', apiKey: makeFakeKey('fake-valid-') });
    await updateChatDefaults(creds, { vendor: 'anthropic', model: 'claude-sonnet-5-5' });
    await ctx.handle.db.execute(
      sql`update user_llm_credentials set secret_ciphertext = set_byte(secret_ciphertext, 0, get_byte(secret_ciphertext, 0) # 255) where user_id = ${userId} and vendor = 'anthropic'`,
    );
    const resolved = await resolveChatCredential({
      db: ctx.handle.db,
      userId,
      keys: keyringFromEnv(env),
      mode: 'fake',
    });
    expect(resolved).toMatchObject({
      status: 'unreadable',
      vendor: 'anthropic',
      createModel: null,
    });
    const reply = await question(userId);
    expect(reply).toMatchObject({
      mode: 'rule',
      llm: { status: 'unreadable', vendor: 'anthropic' },
      setup: { status: 'unreadable' },
    });
    expect(reply.setup!.message).toBe(
      '저장된 Anthropic (Claude) 키를 읽을 수 없습니다. 사용자 설정에서 다시 등록해주세요.',
    );
    expect(reply.candidates.length).toBeGreaterThan(0);
    // DB 상태는 바꾸지 않는다 (변조 흔적 보존, §4.7.1 unreadable 계약)
    const [row] = await queryRows<{ status: string }>(
      ctx.handle.db,
      sql`select status from user_llm_credentials where user_id = ${userId} and vendor = 'anthropic'`,
    );
    expect(row!.status).toBe('valid');
  });

  it('기본값 없이 KEK 가 없으면(키링 null) unreadable', async () => {
    const userId = (await insertUser(ctx.handle, { email: 'rc5@pentasecurity.com' })).id;
    await saveCredential(credentialsCtx(userId), {
      vendor: 'anthropic',
      apiKey: makeFakeKey('fake-valid-'),
    });
    const resolved = await resolveChatCredential({
      db: ctx.handle.db,
      userId,
      keys: null,
      mode: 'fake',
    });
    expect(resolved.status).toBe('unreadable');
  });
});
