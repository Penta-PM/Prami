import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { queryRows } from '@/server/imports/sql-rows';
import { createKeyring } from '@/server/llm/credentials/keyring';
import { saveCredential } from '@/server/llm/credentials/service';

import { insertUser } from '../helpers/pglite';
import { makeFakeKey } from '../helpers/secret';

/**
 * AC-324 `credentials:rewrap`: `--yes` 없이는 대상 호스트·건수만 출력하고 변경 0, `--yes` 면 다시 감싼다 (PRAMI-003 §4.3.4).
 * 실제 PostgreSQL(DB_DRIVER=pg) 대상 — CI integration 잡·격리 컨테이너.
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);
const ROOT = path.resolve(import.meta.dirname, '../..');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

const v1 = { version: 1, key: randomBytes(32) };
const v2 = { version: 2, key: randomBytes(32) };
const keyringEnv = (versions: Array<{ version: number; key: Buffer }>, active: number) => ({
  LLM_CREDENTIALS_KEKS: versions.map((v) => `${v.version}:${v.key.toString('base64')}`).join(','),
  LLM_CREDENTIALS_ACTIVE_KEK: String(active),
});

function rewrap(args: string[]) {
  const result = spawnSync(
    process.execPath,
    [TSX_CLI, '--conditions=react-server', 'scripts/credentials-rewrap.ts', ...args],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DB_DRIVER: 'pg',
        DATABASE_URL: databaseUrl,
        ...keyringEnv([v1, v2], 2),
      },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe.skipIf(!enabled)('credentials:rewrap 확인 단계 (AC-324)', { timeout: 120_000 }, () => {
  let handle: DbHandle;
  let userId: string;

  const myVersions = async () =>
    (
      await queryRows<{ kek_version: number }>(
        handle.db,
        sql`select kek_version from user_llm_credentials where user_id = ${userId}`,
      )
    ).map((row) => row.kek_version);

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
    userId = (await insertUser(handle, { email: `rewrap-${Date.now()}@pentasecurity.com` })).id;
    await saveCredential(
      {
        handle,
        actor: { id: userId, label: 'rewrap' },
        meta: { ip: null, userAgent: 'vitest' },
        keys: createKeyring([v1], 1),
        mode: 'fake',
      },
      { vendor: 'anthropic', apiKey: makeFakeKey() },
    );
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('--yes 없음 → 대상·건수만 출력, 변경 0', () => {
    const run = rewrap([]);
    expect(run.status).toBe(0);
    expect(run.output).toMatch(/대상 pg (localhost|127.0.0.1) · 활성 v2 · 다시 감쌀 행 [1-9]\d*건/);
    expect(run.output).toMatch(/변경 0/);
    expect(run.output).not.toContain(v1.key.toString('base64'));
    return expect(myVersions()).resolves.toEqual([1]);
  });

  it('--yes → 다시 감싼다', async () => {
    const run = rewrap(['--yes']);
    expect(run.status).toBe(0);
    expect(run.output).toMatch(/v2 로 [1-9]\d*건 다시 감쌈/);
    expect(await myVersions()).toEqual([2]);
  });
});
