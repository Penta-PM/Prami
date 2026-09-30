// @vitest-environment node
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { queryRows } from '@/server/imports/sql-rows';
import { createKeyring } from '@/server/llm/credentials/keyring';
import {
  saveCredential,
  verifyOwnCredential,
  type CredentialsContext,
} from '@/server/llm/credentials/service';

import { createTestDb, insertUser } from '../../helpers/pglite';
import { makeFakeKey } from '../../helpers/secret';

/**
 * QA L-3: 검증이 도는 동안 같은 사용자가 키를 교체하면, 이전 키의 검증 결과가 새 행에 기록되면 안 된다.
 * verifyCredential 에 한 번만 도는 훅을 끼워 "검증 호출 중 교체" 를 결정적으로 재현한다.
 */
const hook = vi.hoisted(() => ({ during: null as null | (() => Promise<void>) }));

vi.mock('@/server/llm/verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/llm/verify')>();
  return {
    ...actual,
    verifyCredential: async (...args: Parameters<typeof actual.verifyCredential>) => {
      const during = hook.during;
      hook.during = null;
      const result = await actual.verifyCredential(...args);
      if (during) await during();
      return result;
    },
  };
});

let handle: DbHandle;
let ctx: CredentialsContext;

beforeAll(async () => {
  handle = await createTestDb();
  const user = await insertUser(handle, { email: 'race@pentasecurity.com', role: 'USER' });
  ctx = {
    handle,
    actor: { id: user.id, label: 'race' },
    meta: { ip: null, userAgent: 'vitest' },
    keys: createKeyring([{ version: 1, key: randomBytes(32) }], 1),
    mode: 'fake',
  };
});

afterAll(async () => {
  await handle.close();
});

const rows = () =>
  queryRows<{ id: string; status: string; key_hint: string }>(
    handle.db,
    sql`select id, status, key_hint from user_llm_credentials where user_id = ${ctx.actor.id}`,
  );

describe('검증 중 교체 (QA L-3)', () => {
  it('이전 키(정상)의 검증 결과가 교체된 새 키(무효) 행을 덮어쓰지 않는다', async () => {
    await saveCredential(ctx, { vendor: 'openai', apiKey: makeFakeKey('fake-valid-') });
    const replacement = makeFakeKey('fake-invalid-');
    hook.during = async () => {
      await saveCredential(ctx, { vendor: 'openai', apiKey: replacement });
    };
    const view = await verifyOwnCredential(ctx, { vendor: 'openai' });
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'invalid', key_hint: `fake-…${replacement.slice(-4)}` });
    // 응답도 현재(새) 행 기준
    expect(view).toMatchObject({ status: 'invalid', keyHint: `fake-…${replacement.slice(-4)}` });
    expect(await rows()).toHaveLength(1);
  });
});
