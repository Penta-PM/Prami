import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { queryRows } from '@/server/imports/sql-rows';
import { createKeyring } from '@/server/llm/credentials/keyring';
import {
  deleteOwnCredential,
  saveCredential,
  withDecryptedSecret,
  type CredentialsContext,
} from '@/server/llm/credentials/service';
import { updateChatDefaults } from '@/server/llm/credentials/settings';
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
});
