import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { env } from '@/env';
import { migrateDb } from '@/db/migrate';
import { MISSING_MESSAGE } from '@/server/chat/graph/messages';
import { chatStatus } from '@/server/chat/graph/runtime';
import { queryRows } from '@/server/imports/sql-rows';
import { createKeyring } from '@/server/llm/credentials/keyring';
import {
  deleteOwnCredential,
  saveCredential,
  withDecryptedSecret,
  type CredentialsContext,
} from '@/server/llm/credentials/service';
import { getMySettings, updateChatDefaults } from '@/server/llm/credentials/settings';
import { rateLimiters } from '@/server/rate-limit';

import { makeFakeKey } from '../helpers/secret';

/**
 * PRAMI-002 PR-A — 실제 PostgreSQL 16 (DB_DRIVER=pg). node-postgres 에서 bytea 봉투 암호화 왕복과
 * available_models(text[]) 저장·기본값 교집합 검사(AC-207 ⑦·AC-208)를 확인한다. fake 검증기만 쓴다(실벤더 호출 없음).
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);

describe.skipIf(!enabled)('PostgreSQL LLM 자격 증명 (AC-207 ⑦·AC-208)', () => {
  let handle: DbHandle;
  let ctx: CredentialsContext;

  const availableOf = async (vendor: string) =>
    (
      await queryRows<{ available_models: string[] | null }>(
        handle.db,
        sql`select available_models from user_llm_credentials where user_id = ${ctx.actor.id} and vendor = ${vendor}`,
      )
    )[0]?.available_models;

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
    const [user] = await queryRows<{ id: string }>(
      handle.db,
      sql`insert into users (email, name, created_via) values (${`llm-pg-${Date.now()}@pentasecurity.com`}, 'llm', 'admin') returning id`,
    );
    ctx = {
      handle,
      actor: { id: user!.id, label: 'llm-pg' },
      meta: { ip: null, userAgent: 'vitest' },
      keys: createKeyring([{ version: 1, key: randomBytes(32) }], 1),
      mode: 'fake',
    };
  });

  beforeEach(() => rateLimiters.llmVerify.reset());

  afterAll(async () => {
    // 감사 로그가 append-only 라 사용자 행은 지우지 않는다(이메일에 시각을 붙여 재실행 안전)
    await handle?.close();
  });

  it('bytea 봉투 왕복, 검증 시 목록 ∩ 상수를 text[] 로 저장·목록 실패는 NULL', async () => {
    const key = makeFakeKey('fake-partial-');
    const saved = await saveCredential(ctx, { vendor: 'google', apiKey: key });
    expect(saved).toMatchObject({ status: 'valid', availableModels: ['gemini-3.8-flash'] });
    expect(await availableOf('google')).toEqual(['gemini-3.8-flash']);
    await expect(
      withDecryptedSecret(ctx, ctx.actor.id, 'google', async (secret) => secret),
    ).resolves.toBe(key);
    await saveCredential(ctx, { vendor: 'google', apiKey: makeFakeKey('fake-pagefail-') });
    expect(await availableOf('google')).toBeNull();
    await saveCredential(ctx, { vendor: 'google', apiKey: makeFakeKey('fake-paged-') });
    expect(await availableOf('google')).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });

  it('기본값은 available_models 안의 모델만, 밖이면 VALIDATION·무변경', async () => {
    await saveCredential(ctx, { vendor: 'anthropic', apiKey: makeFakeKey('fake-partial-') });
    await expect(
      updateChatDefaults(ctx, { vendor: 'anthropic', model: 'claude-sonnet-5-5' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const none = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int n from user_settings where user_id = ${ctx.actor.id}`,
    );
    expect(none[0]!.n).toBe(0);
    await expect(
      updateChatDefaults(ctx, { vendor: 'anthropic', model: 'claude-opus-5-5' }),
    ).resolves.toEqual({ vendor: 'anthropic', model: 'claude-opus-5-5', modelReplaced: false });
    await deleteOwnCredential(ctx, { vendor: 'anthropic' });
    await deleteOwnCredential(ctx, { vendor: 'google' });
  });

  it('QA L-3: 같은 사용자·벤더 동시 교체 6건 → 모두 성공, 행 1개, 남은 행은 그중 하나로 복호화', async () => {
    // 동시성만 본다 — 검증 상한(분당 5)은 별도 테스트(AC-207)가 다룬다
    rateLimiters.llmVerify.configure(1000);
    const keys = Array.from({ length: 6 }, () => makeFakeKey('fake-valid-'));
    const results = await Promise.allSettled(
      keys.map((apiKey) => saveCredential(ctx, { vendor: 'openai', apiKey })),
    );
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    const rows = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int n from user_llm_credentials where user_id = ${ctx.actor.id} and vendor = 'openai'`,
    );
    expect(rows[0]!.n).toBe(1);
    const stored = await withDecryptedSecret(ctx, ctx.actor.id, 'openai', async (secret) => secret);
    expect(keys).toContain(stored);
    await deleteOwnCredential(ctx, { vendor: 'openai' });
    rateLimiters.llmVerify.configure(5);
  });

  describe('자격 증명 삭제 시 기본 벤더 정리 (#17 I-3)', () => {
    let seq = 0;
    /** 새 사용자 + anthropic(기본값 claude-opus-5-5)·openai 정상 키 */
    const withDefault = async (): Promise<CredentialsContext> => {
      const [user] = await queryRows<{ id: string }>(
        handle.db,
        sql`insert into users (email, name, created_via) values (${`llm-pg-i3-${Date.now()}-${(seq += 1)}@pentasecurity.com`}, 'llm-i3', 'admin') returning id`,
      );
      const own = { ...ctx, actor: { id: user!.id, label: 'llm-pg-i3' } };
      await saveCredential(own, { vendor: 'anthropic', apiKey: makeFakeKey('fake-valid-') });
      await saveCredential(own, { vendor: 'openai', apiKey: makeFakeKey('fake-valid-') });
      await updateChatDefaults(own, { vendor: 'anthropic', model: 'claude-opus-5-5' });
      return own;
    };
    const defaultsOf = async (own: CredentialsContext) =>
      (
        await queryRows<{ vendor: string | null; model: string | null }>(
          handle.db,
          sql`select chat_default_vendor vendor, chat_default_model model from user_settings where user_id = ${own.actor.id}`,
        )
      )[0];
    const auditsOf = async (own: CredentialsContext) =>
      queryRows<{ action: string; before: unknown; after: unknown }>(
        handle.db,
        sql`select action, before, after from audit_logs where actor_user_id = ${own.actor.id} order by id`,
      );

    beforeEach(() => rateLimiters.llmVerify.configure(1000));
    afterAll(() => rateLimiters.llmVerify.configure(5));

    it('(1) 기본 벤더 키 삭제 → vendor·model null, 감사 2건(credential delete·default update)', async () => {
      const own = await withDefault();
      const before = (await auditsOf(own)).length;
      await expect(deleteOwnCredential(own, { vendor: 'anthropic' })).resolves.toEqual({
        deleted: true,
      });
      expect(await defaultsOf(own)).toEqual({ vendor: null, model: null });
      expect((await auditsOf(own)).slice(before)).toEqual([
        {
          action: 'settings.llm_credential.delete',
          before: { vendor: 'anthropic', authType: 'api_key' },
          after: null,
        },
        {
          action: 'settings.llm_default.update',
          before: { vendor: 'anthropic', model: 'claude-opus-5-5' },
          after: { vendor: null, model: null },
        },
      ]);
    });

    it('(2) 다른 벤더 키 삭제 → 기본값 그대로, default update 감사 없음', async () => {
      const own = await withDefault();
      const before = (await auditsOf(own)).length;
      await deleteOwnCredential(own, { vendor: 'openai' });
      expect(await defaultsOf(own)).toEqual({ vendor: 'anthropic', model: 'claude-opus-5-5' });
      expect((await auditsOf(own)).slice(before).map((row) => row.action)).toEqual([
        'settings.llm_credential.delete',
      ]);
    });

    it('(3) 기본 벤더 키 교체 → 기본값 그대로', async () => {
      const own = await withDefault();
      const before = (await auditsOf(own)).length;
      await saveCredential(own, { vendor: 'anthropic', apiKey: makeFakeKey('fake-valid-') });
      expect(await defaultsOf(own)).toEqual({ vendor: 'anthropic', model: 'claude-opus-5-5' });
      const added = (await auditsOf(own)).slice(before).map((row) => row.action);
      expect(added).toContain('settings.llm_credential.replace');
      expect(added).not.toContain('settings.llm_default.update');
    });

    it('(4) 삭제 후 같은 벤더 키 재등록 → 기본값 되살아나지 않음', async () => {
      const own = await withDefault();
      await deleteOwnCredential(own, { vendor: 'anthropic' });
      await saveCredential(own, { vendor: 'anthropic', apiKey: makeFakeKey('fake-valid-') });
      expect(await defaultsOf(own)).toEqual({ vendor: null, model: null });
    });

    it('(5) 정상 키 0건 → 설정 키 목록 비고 기본값 없음, 챗봇 상태 missing + MISSING 배너 문구', async () => {
      const own = await withDefault();
      await deleteOwnCredential(own, { vendor: 'anthropic' });
      await deleteOwnCredential(own, { vendor: 'openai' });
      const view = await getMySettings({
        db: handle.db,
        userId: own.actor.id,
        keys: own.keys,
        mode: 'fake',
        testMode: true,
      });
      expect(view.credentials).toEqual([]);
      expect(view.defaults).toEqual({ vendor: null, model: null, modelReplaced: false });
      const status = await chatStatus({ db: handle.db, userId: own.actor.id, env });
      expect(status.llm).toMatchObject({ status: 'missing', vendor: null, model: null });
      expect('setup' in status ? status.setup?.message : undefined).toBe(MISSING_MESSAGE);
    });

    it('기본값 정리가 실패하면 키 삭제·감사도 롤백 (같은 트랜잭션)', async () => {
      const own = await withDefault();
      const before = await auditsOf(own);
      const fn = `i3_fail_${own.actor.id.replace(/-/g, '')}`;
      await handle.db.execute(
        sql.raw(`create function ${fn}() returns trigger language plpgsql as $body$
          begin raise exception 'i3 forced failure'; end $body$`),
      );
      await handle.db.execute(
        sql.raw(`create trigger ${fn} before update on user_settings for each row
          when (old.user_id = '${own.actor.id}' and new.chat_default_vendor is null)
          execute function ${fn}()`),
      );
      try {
        await expect(deleteOwnCredential(own, { vendor: 'anthropic' })).rejects.toThrow();
      } finally {
        await handle.db.execute(sql.raw(`drop trigger if exists ${fn} on user_settings`));
        await handle.db.execute(sql.raw(`drop function if exists ${fn}()`));
      }
      const rows = await queryRows<{ n: number }>(
        handle.db,
        sql`select count(*)::int n from user_llm_credentials where user_id = ${own.actor.id} and vendor = 'anthropic'`,
      );
      expect(rows[0]!.n).toBe(1);
      expect(await defaultsOf(own)).toEqual({ vendor: 'anthropic', model: 'claude-opus-5-5' });
      expect(await auditsOf(own)).toEqual(before);
    });
  });
});
