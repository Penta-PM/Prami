import { randomBytes, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { expect } from 'vitest';

import type { DbHandle } from '@/db';
import { queryRows } from '@/server/imports/sql-rows';

import { describeColumns, listIndexes } from './db-introspect';

/**
 * AC-201 (PRAMI-002 §4.8): user_llm_credentials · user_settings 컬럼·제약·FK CASCADE 검사.
 * PGlite 단위 테스트와 실제 PostgreSQL 통합 테스트가 같은 기준으로 호출한다.
 */
export const CREDENTIAL_COLUMNS = [
  'id',
  'user_id',
  'vendor',
  'auth_type',
  'secret_ciphertext',
  'secret_iv',
  'secret_tag',
  'dek_wrapped',
  'dek_iv',
  'dek_tag',
  'kek_version',
  'key_hint',
  'status',
  'last_verified_at',
  'last_error_code',
  'last_used_at',
  'created_at',
  'updated_at',
] as const;

type RowOverrides = Partial<{
  vendor: string;
  secretIv: Buffer;
  dekWrapped: Buffer;
  kekVersion: number;
  keyHint: string;
}>;

function insertCredential(handle: DbHandle, userId: string, overrides: RowOverrides = {}) {
  const row = {
    vendor: 'anthropic',
    secretIv: randomBytes(12),
    dekWrapped: randomBytes(32),
    kekVersion: 1,
    keyHint: 'sk-ant-…WXYZ',
    ...overrides,
  };
  return handle.db.execute(sql`
    insert into user_llm_credentials
      (id, user_id, vendor, auth_type, secret_ciphertext, secret_iv, secret_tag,
       dek_wrapped, dek_iv, dek_tag, kek_version, key_hint)
    values (${randomUUID()}, ${userId}, ${row.vendor}, 'api_key', ${randomBytes(40)}, ${row.secretIv},
      ${randomBytes(16)}, ${row.dekWrapped}, ${randomBytes(12)}, ${randomBytes(16)},
      ${row.kekVersion}, ${row.keyHint})
  `);
}

async function insertTestUser(handle: DbHandle, email: string): Promise<string> {
  const [row] = await queryRows<{ id: string }>(
    handle.db,
    sql`insert into users (email, name, created_via) values (${email}, 'llm', 'admin') returning id`,
  );
  return row!.id;
}

async function countFor(handle: DbHandle, table: string, userId: string): Promise<number> {
  const [row] = await queryRows<{ n: number }>(
    handle.db,
    sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${userId}`,
  );
  return row!.n;
}

export async function assertCredentialColumns(handle: DbHandle): Promise<void> {
  const columns = await describeColumns(handle.db, 'user_llm_credentials');
  expect(columns.map((column) => column.column)).toEqual([...CREDENTIAL_COLUMNS]);
  const byName = new Map(columns.map((column) => [column.column, column]));
  for (const name of ['secret_ciphertext', 'secret_iv', 'dek_wrapped', 'dek_tag']) {
    expect(byName.get(name)).toMatchObject({ dataType: 'bytea', nullable: false });
  }
  // 평문 컬럼이 없다
  expect(columns.map((column) => column.column).join(',')).not.toMatch(/api_key|plain|secret,/);
  expect(await listIndexes(handle.db, 'user_llm_credentials')).toEqual(
    expect.arrayContaining([
      'user_llm_credentials_user_vendor_uq',
      'user_llm_credentials_kek_version_idx',
    ]),
  );
  const settings = await describeColumns(handle.db, 'user_settings');
  expect(settings.map((column) => column.column)).toEqual([
    'user_id',
    'chat_default_vendor',
    'chat_default_model',
    'updated_at',
  ]);
}

/** UNIQUE(user_id, vendor)·CHECK·FK ON DELETE CASCADE 를 실제 DML 로 확인 */
export async function assertCredentialConstraints(handle: DbHandle, email: string): Promise<void> {
  const userId = await insertTestUser(handle, email);
  await insertCredential(handle, userId);
  await expect(insertCredential(handle, userId)).rejects.toThrow();
  await insertCredential(handle, userId, { vendor: 'openai', keyHint: '…0000' });
  const bad: RowOverrides[] = [
    { vendor: 'Bad Vendor' },
    { secretIv: randomBytes(16) },
    { dekWrapped: randomBytes(16) },
    { kekVersion: 0 },
    { keyHint: 'sk-ant-abcdefghijklmnop' },
  ];
  for (const [index, overrides] of bad.entries()) {
    await expect(
      insertCredential(handle, userId, { vendor: `v${index}x`, ...overrides }),
    ).rejects.toThrow();
  }
  await handle.db.execute(
    sql`insert into user_settings (user_id, chat_default_vendor, chat_default_model) values (${userId}, 'anthropic', 'claude-haiku-4-5')`,
  );
  expect(await countFor(handle, 'user_llm_credentials', userId)).toBe(2);
  await handle.db.execute(sql`delete from users where id = ${userId}`);
  expect(await countFor(handle, 'user_llm_credentials', userId)).toBe(0);
  expect(await countFor(handle, 'user_settings', userId)).toBe(0);
}
