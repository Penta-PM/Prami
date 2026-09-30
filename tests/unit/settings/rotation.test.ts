// @vitest-environment node
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { queryRows } from '@/server/imports/sql-rows';
import { createKeyring, type KeyProvider } from '@/server/llm/credentials/keyring';
import { rewrapAll } from '@/server/llm/credentials/rewrap';
import {
  saveCredential,
  verifyOwnCredential,
  withDecryptedSecret,
  type CredentialsContext,
} from '@/server/llm/credentials/service';
import { getMySettings, updateChatDefaults } from '@/server/llm/credentials/settings';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';
import { makeFakeKey } from '../../helpers/secret';

/** AC-210 KEK 회전: v1 등록 → v2 활성 → 새 등록 v2 → rewrap → 전부 v2·복호화 성공·감사 → v1 제거 후에도 복호화, rewrap 전 제거 시 unreadable */
const v1 = { version: 1, key: randomBytes(32) };
const v2 = { version: 2, key: randomBytes(32) };
let handle: DbHandle;
let userId: string;

const ctxWith = (keys: KeyProvider | null): CredentialsContext => ({
  handle,
  actor: { id: userId, label: 'rot@pentasecurity.com' },
  meta: { ip: null, userAgent: 'vitest' },
  keys,
  mode: 'fake',
});

const versions = async () =>
  (
    await queryRows<{ vendor: string; kek_version: number }>(
      handle.db,
      sql`select vendor, kek_version from user_llm_credentials where user_id = ${userId} order by vendor`,
    )
  ).map((row) => `${row.vendor}:${row.kek_version}`);

beforeAll(async () => {
  handle = await createTestDb();
  userId = (await insertUser(handle, { email: 'rot@pentasecurity.com', role: 'USER' })).id;
});

afterAll(async () => {
  await handle.close();
});

describe('KEK 회전 (AC-210)', () => {
  it('회전·rewrap·옛 KEK 제거 전 과정에서 키가 계속 복호화된다', async () => {
    const keyA = makeFakeKey();
    await saveCredential(ctxWith(createKeyring([v1], 1)), { vendor: 'anthropic', apiKey: keyA });
    const both = createKeyring([v1, v2], 2);
    const keyB = makeFakeKey();
    await saveCredential(ctxWith(both), { vendor: 'openai', apiKey: keyB });
    expect(await versions()).toEqual(['anthropic:1', 'openai:2']);

    const summary = await rewrapAll(handle, both, 1);
    expect(summary).toEqual({ toVersion: 2, fromVersions: [1], count: 1, unreadable: 0 });
    expect(await versions()).toEqual(['anthropic:2', 'openai:2']);
    const [audit] = await auditByAction(handle, 'system.kek_rewrap');
    expect(audit).toMatchObject({ actorUserId: null, actorLabel: 'system', after: summary });

    const onlyV2 = createKeyring([v2], 2);
    await expect(
      withDecryptedSecret(ctxWith(onlyV2), userId, 'anthropic', async (secret) => secret),
    ).resolves.toBe(keyA);
    await expect(
      withDecryptedSecret(ctxWith(onlyV2), userId, 'openai', async (secret) => secret),
    ).resolves.toBe(keyB);
  });

  it('rewrap 전에 옛 KEK 를 지우면 해당 행은 "재등록 필요"(unreadable), 화면·검증은 오류 없이 동작', async () => {
    const other = (await insertUser(handle, { email: 'rot2@pentasecurity.com', role: 'USER' })).id;
    const ctx = (keys: KeyProvider) => ({ ...ctxWith(keys), actor: { id: other, label: 'rot2' } });
    await saveCredential(ctx(createKeyring([v1], 1)), { vendor: 'google', apiKey: makeFakeKey() });
    const onlyV2 = createKeyring([v2], 2);
    const view = await getMySettings({
      db: handle.db,
      userId: other,
      keys: onlyV2,
      mode: 'fake',
      testMode: true,
    });
    expect(view.credentials.map((entry) => entry.status)).toEqual(['unreadable']);
    const verified = await verifyOwnCredential(ctx(onlyV2), { vendor: 'google' });
    expect(verified.status).toBe('unreadable');
    // KEK 가 전혀 없을 때도 화면은 동작하고 등록만 막힌다
    const noKeys = await getMySettings({
      db: handle.db,
      userId: other,
      keys: null,
      mode: 'fake',
      testMode: true,
    });
    expect(noKeys).toMatchObject({ keyringReady: false, credentials: [{ status: 'unreadable' }] });
    await expect(
      saveCredential(
        { ...ctxWith(null), actor: { id: other, label: 'rot2' } },
        { vendor: 'openai', apiKey: makeFakeKey() },
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    // rewrap 은 읽을 수 없는 행을 건너뛰고 센다
    const summary = await rewrapAll(
      handle,
      createKeyring([v2, { version: 3, key: randomBytes(32) }], 3),
    );
    expect(summary.unreadable).toBeGreaterThanOrEqual(1);
  });
});

describe('변조된 행 (QA L-1)', () => {
  it('암호문 1바이트 변조 → 새로고침(조회)에도 "unreadable", 기본값 지정 거부, 재등록하면 정상', async () => {
    const owner = (await insertUser(handle, { email: 'tamper@pentasecurity.com', role: 'USER' }))
      .id;
    const keys = createKeyring([v1], 1);
    const ctx = { ...ctxWith(keys), actor: { id: owner, label: 'tamper' } };
    await saveCredential(ctx, { vendor: 'anthropic', apiKey: makeFakeKey() });
    await handle.db.execute(
      sql`update user_llm_credentials set secret_ciphertext = set_byte(secret_ciphertext, 0, get_byte(secret_ciphertext, 0) # 255) where user_id = ${owner}`,
    );
    const view = () =>
      getMySettings({ db: handle.db, userId: owner, keys, mode: 'fake', testMode: true });
    // 검증 전(조회만)에도 읽을 수 없음을 보인다
    expect((await view()).credentials.map((entry) => entry.status)).toEqual(['unreadable']);
    expect((await verifyOwnCredential(ctx, { vendor: 'anthropic' })).status).toBe('unreadable');
    expect((await view()).credentials.map((entry) => entry.status)).toEqual(['unreadable']);
    await expect(
      updateChatDefaults(ctx, { vendor: 'anthropic', model: 'claude-opus-5-5' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await saveCredential(ctx, { vendor: 'anthropic', apiKey: makeFakeKey() });
    expect((await view()).credentials.map((entry) => entry.status)).toEqual(['valid']);
  });
});
