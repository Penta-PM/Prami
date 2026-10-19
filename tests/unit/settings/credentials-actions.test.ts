// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs } from '@/db/schema';
import { queryRows } from '@/server/imports/sql-rows';

import { createTestDb, insertUser } from '../../helpers/pglite';
import { expectNoSecret, makeFakeKey } from '../../helpers/secret';

/**
 * PRAMI-002 PR-A 보안 불변식 (AC-203·204·205·206·207·208·212) — 실제 Server Actions + PGlite.
 * 키 K 는 테스트가 만든 가짜 키. "노출 없음" = K 전체와 연속 12자 부분 문자열이 모두 없음.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
  logs: [] as string[],
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
  signIn: vi.fn(),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
  currentRequestId: async () => 'req-test-0001',
}));

const actions = await import('@/features/settings/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');
const { rateLimiters } = await import('@/server/rate-limit');
const { getMySettings } = await import('@/server/llm/credentials/settings');
const { keyringFromEnv } = await import('@/server/llm/credentials/keyring');
const { env } = await import('@/env');
const { chatStatus } = await import('@/server/chat/graph/runtime');
const { MISSING_MESSAGE } = await import('@/server/chat/graph/messages');

let userA: string;
let userB: string;
let admin: string;
const collected: string[] = [];

const as = (id: string | undefined) => {
  state.sessionUserId = id;
  invalidateSessionUser();
};
const record = (value: unknown) => {
  collected.push(JSON.stringify(value));
  return value;
};

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...allKeys(entry)]);
  }
  return [];
}

/** 모든 테이블 행을 JSON 텍스트로 + 자격 증명 bytea 를 escape·hex 로 (AC-203) */
async function dumpDatabase(): Promise<string> {
  const tables = await queryRows<{ table_name: string }>(
    state.handle!.db,
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const parts: string[] = [];
  for (const { table_name } of tables) {
    const rows = await queryRows<{ row: string }>(
      state.handle!.db,
      sql.raw(`select row_to_json(t)::text as row from "${table_name}" t`),
    );
    parts.push(...rows.map((entry) => entry.row));
  }
  const bytes = await queryRows<Record<string, string>>(
    state.handle!.db,
    sql`select encode(secret_ciphertext,'escape') a, encode(secret_ciphertext,'hex') b, encode(dek_wrapped,'escape') c,
        secret_ciphertext::text d, key_hint e from user_llm_credentials`,
  );
  parts.push(...bytes.map((row) => Object.values(row).join('|')));
  return parts.join('\n');
}

beforeAll(async () => {
  state.handle = await createTestDb();
  userA = (await insertUser(state.handle, { email: 'a@pentasecurity.com', role: 'USER' })).id;
  userB = (await insertUser(state.handle, { email: 'b@pentasecurity.com', role: 'USER' })).id;
  admin = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' })).id;
  for (const level of ['error', 'warn', 'info', 'log'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
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
  rateLimiters.llmVerify.reset();
  rateLimiters.llmVerify.configure(1000);
});

afterEach(() => as(undefined));

describe('등록 → 검증 → 교체 → 삭제 전 흐름에서 키 노출 없음 (AC-203·204)', () => {
  it('fake-echo(오류 메시지에 키 반복) 포함 전 흐름: Action 반환·DB 덤프·로그·감사·오류 문구에 K 없음', async () => {
    as(userA);
    const K = makeFakeKey('fake-valid-');
    const saved = record(await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: K }));
    expect(saved).toMatchObject({
      ok: true,
      data: { vendor: 'anthropic', status: 'valid', authType: 'api_key' },
    });
    const hint = (saved as { data: { keyHint: string } }).data.keyHint;
    expect(hint).toBe(`fake-…${K.replace(/[^A-Za-z0-9]/g, '').slice(-4)}`);

    record(await actions.verifyLlmCredentialAction({ vendor: 'anthropic' }));
    const ECHO = makeFakeKey('fake-echo-');
    const echoed = record(
      await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: ECHO }),
    );
    expect(echoed).toMatchObject({
      ok: true,
      data: { status: 'unverified', lastErrorCode: 'unavailable' },
    });
    const invalidKey = makeFakeKey('fake-invalid-');
    record(await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: invalidKey }));
    const badFormat = record(
      await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: `${K}!!` }),
    );
    expect(badFormat).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });

    const settings = record(
      await getMySettings({
        db: state.handle!.db,
        userId: userA,
        keys: keyringFromEnv(env),
        mode: 'fake',
        testMode: true,
      }),
    );
    const dbDump = await dumpDatabase();
    const audits = JSON.stringify(await state.handle!.db.select().from(auditLogs));
    for (const secret of [K, ECHO, invalidKey]) {
      expectNoSecret(collected.join('\n'), secret, 'Action 반환·getMySettings');
      expectNoSecret(dbDump, secret, 'DB 덤프');
      expectNoSecret(state.logs.join('\n'), secret, '로그');
      expectNoSecret(audits, secret, '감사 로그');
    }
    // 감사에는 힌트도 없다
    expect(audits).not.toContain(hint);
    // 뷰 DTO 키 목록 스냅샷: 암호문·DEK·평문 필드 없음
    const view = (settings as { credentials: Record<string, unknown>[] }).credentials[0]!;
    expect(Object.keys(view).sort()).toEqual([
      'authType',
      'availableModels',
      'createdAt',
      'keyHint',
      'lastErrorCode',
      'lastUsedAt',
      'lastVerifiedAt',
      'status',
      'vendor',
      'vendorLabel',
    ]);
    // getMySettings 전체의 필드 이름에 secret·dek·ciphertext·apiKey 가 없다 (값이 아니라 키 목록 — 콘솔 URL 의 'apikey' 경로는 제외)
    expect(allKeys(settings).filter((key) => /secret|dek|ciphertext|apiKey/i.test(key))).toEqual(
      [],
    );

    const deleted = record(await actions.deleteLlmCredentialAction({ vendor: 'anthropic' }));
    expect(deleted).toEqual({ ok: true, data: { deleted: true } });
  });
});

describe('본인만 (AC-205, §4.7.1)', () => {
  it('B·ADMIN 에게 A 의 자격 증명·힌트가 없고, B 의 삭제는 B 본인 행만 대상(NOT_FOUND), A 행 무변경', async () => {
    as(userA);
    const K = makeFakeKey();
    const saved = await actions.saveLlmCredentialAction({ vendor: 'openai', apiKey: K });
    if (!saved.ok) throw new Error('unreachable');
    for (const other of [userB, admin]) {
      const view = await getMySettings({
        db: state.handle!.db,
        userId: other,
        keys: keyringFromEnv(env),
        mode: 'fake',
        testMode: true,
      });
      expect(view.credentials).toEqual([]);
      expect(JSON.stringify(view)).not.toContain(saved.data.keyHint);
      as(other);
      expect(await actions.deleteLlmCredentialAction({ vendor: 'openai' })).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
      expect(await actions.verifyLlmCredentialAction({ vendor: 'openai' })).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    const rows = await queryRows<{ n: number }>(
      state.handle!.db,
      sql`select count(*)::int n from user_llm_credentials where user_id = ${userA} and vendor = 'openai'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('어떤 Action 이든 userId 추가 필드 → VALIDATION, DB 무변경', async () => {
    as(admin);
    const before = await state.handle!.db.$count(auditLogs);
    const K = makeFakeKey();
    for (const call of [
      () => actions.saveLlmCredentialAction({ vendor: 'openai', apiKey: K, userId: userA }),
      () => actions.verifyLlmCredentialAction({ vendor: 'openai', userId: userA }),
      () => actions.deleteLlmCredentialAction({ vendor: 'openai', userId: userA }),
      () =>
        actions.updateChatDefaultsAction({ vendor: 'openai', model: 'gpt-6.1-sol', userId: userA }),
    ]) {
      expect(await call()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    }
    expect(await state.handle!.db.$count(auditLogs)).toBe(before);
  });
});

describe('삭제 즉시 파기 (AC-206)', () => {
  it('삭제 직후 행 0건(soft delete 없음), 감사 delete 1행 before {vendor, authType}·after null·힌트 없음', async () => {
    as(userB);
    const saved = await actions.saveLlmCredentialAction({
      vendor: 'google',
      apiKey: makeFakeKey(),
    });
    if (!saved.ok) throw new Error('unreachable');
    expect(await actions.deleteLlmCredentialAction({ vendor: 'google' })).toEqual({
      ok: true,
      data: { deleted: true },
    });
    const rows = await queryRows<{ n: number }>(
      state.handle!.db,
      sql`select count(*)::int n from user_llm_credentials where user_id = ${userB} and vendor = 'google'`,
    );
    expect(rows[0]!.n).toBe(0);
    const audits = await queryRows<{ before: unknown; after: unknown }>(
      state.handle!.db,
      sql`select before, after from audit_logs where action = 'settings.llm_credential.delete' and actor_user_id = ${userB}`,
    );
    expect(audits).toEqual([{ before: { vendor: 'google', authType: 'api_key' }, after: null }]);
    expect(JSON.stringify(audits)).not.toContain(saved.data.keyHint);
  });
});

describe('검증 (AC-207)', () => {
  it.each([
    ['fake-valid-', 'valid', null],
    ['fake-invalid-', 'invalid', 'invalid_key'],
    ['fake-gemini400-', 'invalid', 'invalid_key'],
    ['fake-403-', 'forbidden', 'forbidden'],
    ['fake-429-', 'rate_limited', 'rate_limited'],
  ])('%s → 상태 %s, 감사 verify 1행 추가', async (prefix, status, code) => {
    as(userB);
    const vendor = prefix === 'fake-gemini400-' ? 'google' : 'anthropic';
    await actions.saveLlmCredentialAction({ vendor, apiKey: makeFakeKey(prefix) });
    const count = async () =>
      (
        await queryRows<{ n: number }>(
          state.handle!.db,
          sql`select count(*)::int n from audit_logs where action = 'settings.llm_credential.verify' and actor_user_id = ${userB}`,
        )
      )[0]!.n;
    const before = await count();
    const result = await actions.verifyLlmCredentialAction({ vendor });
    expect(result).toMatchObject({ ok: true, data: { status, lastErrorCode: code } });
    if (status === 'valid')
      expect((result as { data: { lastVerifiedAt: string } }).data.lastVerifiedAt).toBeTruthy();
    expect(await count()).toBe(before + 1);
    await actions.deleteLlmCredentialAction({ vendor });
  });

  it('5xx·타임아웃 → 상태 유지 + last_error_code=unavailable', async () => {
    as(userB);
    await actions.saveLlmCredentialAction({ vendor: 'openai', apiKey: makeFakeKey('fake-500-') });
    const result = await actions.verifyLlmCredentialAction({ vendor: 'openai' });
    expect(result).toMatchObject({
      ok: true,
      data: { status: 'unverified', lastErrorCode: 'unavailable' },
    });
    await actions.deleteLlmCredentialAction({ vendor: 'openai' });
  });

  it('저장(자동 검증)+수동 검증 합쳐 분당 5회, 6번째는 RATE_LIMITED — 저장 경로로 키 오라클 상한을 우회 못함', async () => {
    rateLimiters.llmVerify.configure(5);
    as(userB);
    await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: makeFakeKey() });
    for (let index = 0; index < 4; index += 1) {
      expect(await actions.verifyLlmCredentialAction({ vendor: 'anthropic' })).toMatchObject({
        ok: true,
      });
    }
    const limited = {
      ok: false,
      error: { code: 'RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) as number } },
    };
    expect(await actions.verifyLlmCredentialAction({ vendor: 'anthropic' })).toMatchObject(limited);
    // 상한 초과 저장은 저장 자체를 거부한다 — 기존 키·힌트 그대로, 벤더 호출 없음
    const credentialsOfB = async () =>
      (
        await getMySettings({
          db: state.handle!.db,
          userId: userB,
          keys: keyringFromEnv(env),
          mode: 'fake',
          testMode: true,
        })
      ).credentials;
    const before = await credentialsOfB();
    const candidate = makeFakeKey('fake-invalid-');
    expect(
      await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: candidate }),
    ).toMatchObject(limited);
    expect(await credentialsOfB()).toEqual(before);
    await actions.deleteLlmCredentialAction({ vendor: 'anthropic' });
  });
});

describe('기본값 (AC-208)', () => {
  it('본인 valid 벤더 + 상수 모델만 허용, 그 외 VALIDATION·무변경, 성공 시 감사 before/after', async () => {
    as(userA);
    await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: makeFakeKey() });
    await actions.saveLlmCredentialAction({
      vendor: 'google',
      apiKey: makeFakeKey('fake-invalid-'),
    });
    for (const input of [
      { vendor: 'anthropic', model: 'gpt-6.1-sol' },
      { vendor: 'anthropic', model: 'claude-9' },
      { vendor: 'google', model: 'gemini-3.8-flash' },
      { vendor: 'openrouter', model: 'x' },
    ]) {
      expect(await actions.updateChatDefaultsAction(input)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
    const empty = await queryRows<{ n: number }>(
      state.handle!.db,
      sql`select count(*)::int n from user_settings where user_id = ${userA}`,
    );
    expect(empty[0]!.n).toBe(0);
    expect(
      await actions.updateChatDefaultsAction({ vendor: 'anthropic', model: 'claude-sonnet-5-5' }),
    ).toEqual({
      ok: true,
      data: { vendor: 'anthropic', model: 'claude-sonnet-5-5', modelReplaced: false },
    });
    const audits = await queryRows<{ before: unknown; after: unknown }>(
      state.handle!.db,
      sql`select before, after from audit_logs where action = 'settings.llm_default.update' and actor_user_id = ${userA}`,
    );
    expect(audits).toEqual([
      {
        before: { vendor: null, model: null },
        after: { vendor: 'anthropic', model: 'claude-sonnet-5-5' },
      },
    ]);
  });
});

describe('사용 가능 모델 저장·기본값 교집합 (AC-207 ⑦·AC-208, r2)', () => {
  const availableOf = async (userId: string, vendor: string) =>
    (
      await queryRows<{ available_models: string[] | null }>(
        state.handle!.db,
        sql`select available_models from user_llm_credentials where user_id = ${userId} and vendor = ${vendor}`,
      )
    )[0]?.available_models;
  const settingsRow = async (userId: string) =>
    queryRows<{ chat_default_vendor: string | null; chat_default_model: string | null }>(
      state.handle!.db,
      sql`select chat_default_vendor, chat_default_model from user_settings where user_id = ${userId}`,
    );

  it('검증 시 목록 ∩ 상수를 저장, 목록 실패·검증 전은 NULL, 교체하면 다시 계산', async () => {
    as(userB);
    const partial = await actions.saveLlmCredentialAction({
      vendor: 'openai',
      apiKey: makeFakeKey('fake-partial-'),
    });
    expect(partial).toMatchObject({
      ok: true,
      data: { status: 'valid', availableModels: ['gpt-6.1-sol'] },
    });
    expect(await availableOf(userB, 'openai')).toEqual(['gpt-6.1-sol']);
    await actions.saveLlmCredentialAction({
      vendor: 'openai',
      apiKey: makeFakeKey('fake-nolist-'),
    });
    expect(await availableOf(userB, 'openai')).toBeNull();
    await actions.saveLlmCredentialAction({ vendor: 'openai', apiKey: makeFakeKey('fake-valid-') });
    expect(await availableOf(userB, 'openai')).toEqual([
      'gpt-6.1-sol',
      'gpt-6-luna',
      'gpt-6-astra',
    ]);
    // 수동 재검증도 같은 계산 + 감사 verify 1행
    expect(await actions.verifyLlmCredentialAction({ vendor: 'openai' })).toMatchObject({
      ok: true,
      data: { availableModels: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra'] },
    });
    await actions.deleteLlmCredentialAction({ vendor: 'openai' });
  });

  it('available_models 밖 모델은 VALIDATION·무변경, 안의 모델과 레거시는 허용, NULL 이면 상수 전체 허용', async () => {
    as(userB);
    await actions.saveLlmCredentialAction({
      vendor: 'openai',
      apiKey: makeFakeKey('fake-partial-'),
    });
    await actions.saveLlmCredentialAction({
      vendor: 'anthropic',
      apiKey: makeFakeKey('fake-nolist-'),
    });
    const before = await settingsRow(userB);
    for (const input of [
      { vendor: 'openai', model: 'gpt-6-luna' },
      { vendor: 'openai', model: 'gpt-6-astra' },
    ]) {
      expect(await actions.updateChatDefaultsAction(input)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION', message: '이 키로 사용할 수 없는 모델입니다' },
      });
    }
    expect(await settingsRow(userB)).toEqual(before);
    expect(
      await actions.updateChatDefaultsAction({ vendor: 'openai', model: 'gpt-6.1-sol' }),
    ).toMatchObject({ ok: true });
    // anthropic 은 목록 미확인(NULL) → 상수 전체, 레거시 claude-opus-5 도 선택 가능
    expect(await availableOf(userB, 'anthropic')).toBeNull();
    expect(
      await actions.updateChatDefaultsAction({ vendor: 'anthropic', model: 'claude-opus-5' }),
    ).toEqual({
      ok: true,
      data: { vendor: 'anthropic', model: 'claude-opus-5', modelReplaced: false },
    });
    const audits = await queryRows<{ before: unknown; after: unknown }>(
      state.handle!.db,
      sql`select before, after from audit_logs where action = 'settings.llm_default.update' and actor_user_id = ${userB} order by id`,
    );
    expect(audits.at(-1)).toEqual({
      before: { vendor: 'openai', model: 'gpt-6.1-sol' },
      after: { vendor: 'anthropic', model: 'claude-opus-5' },
    });
    await actions.deleteLlmCredentialAction({ vendor: 'openai' });
    await actions.deleteLlmCredentialAction({ vendor: 'anthropic' });
  });

  it('저장된 모델이 상수에서 사라지면 벤더 기본 모델로 대체해 보이고 안내 플래그', async () => {
    await state.handle!.db.execute(
      sql`insert into user_settings (user_id, chat_default_vendor, chat_default_model) values (${admin}, 'anthropic', 'claude-retired-x')
          on conflict (user_id) do update set chat_default_vendor = 'anthropic', chat_default_model = 'claude-retired-x'`,
    );
    const view = await getMySettings({
      db: state.handle!.db,
      userId: admin,
      keys: keyringFromEnv(env),
      mode: 'fake',
      testMode: true,
    });
    expect(view.defaults).toEqual({
      vendor: 'anthropic',
      model: 'claude-opus-5-5',
      modelReplaced: true,
    });
    const anthropicView = view.vendors.find((vendor) => vendor.id === 'anthropic')!;
    expect(
      anthropicView.models
        .filter((model) => model.lifecycleLabel === '레거시')
        .map((model) => model.id),
    ).toEqual(['claude-opus-5', 'claude-sonnet-5']);
  });
});

describe('자격 증명 삭제 시 기본 벤더 정리 (#17 I-3)', () => {
  let seq = 0;
  const freshUser = async () =>
    (await insertUser(state.handle!, { email: `i3-${(seq += 1)}@pentasecurity.com`, role: 'USER' }))
      .id;
  const defaultsOf = async (userId: string) =>
    (
      await queryRows<{ vendor: string | null; model: string | null }>(
        state.handle!.db,
        sql`select chat_default_vendor vendor, chat_default_model model from user_settings where user_id = ${userId}`,
      )
    )[0];
  const auditsOf = async (userId: string) =>
    queryRows<{ action: string; before: unknown; after: unknown }>(
      state.handle!.db,
      sql`select action, before, after from audit_logs where actor_user_id = ${userId} order by id`,
    );
  const viewOf = (userId: string) =>
    getMySettings({
      db: state.handle!.db,
      userId,
      keys: keyringFromEnv(env),
      mode: 'fake',
      testMode: true,
    });
  /** anthropic(기본값 claude-opus-5-5) + openai 정상 키 */
  const withDefault = async () => {
    const userId = await freshUser();
    as(userId);
    await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: makeFakeKey() });
    await actions.saveLlmCredentialAction({ vendor: 'openai', apiKey: makeFakeKey() });
    expect(
      await actions.updateChatDefaultsAction({ vendor: 'anthropic', model: 'claude-opus-5-5' }),
    ).toMatchObject({ ok: true });
    return userId;
  };

  it('(1) 기본 벤더의 키를 삭제하면 vendor·model 이 null, 감사 2건(credential delete·default update)', async () => {
    const userId = await withDefault();
    const before = (await auditsOf(userId)).length;
    expect(await actions.deleteLlmCredentialAction({ vendor: 'anthropic' })).toEqual({
      ok: true,
      data: { deleted: true },
    });
    expect(await defaultsOf(userId)).toEqual({ vendor: null, model: null });
    expect((await auditsOf(userId)).slice(before)).toEqual([
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
    expect((await viewOf(userId)).defaults).toEqual({
      vendor: null,
      model: null,
      modelReplaced: false,
    });
  });

  it('(2) 다른 벤더 키를 삭제하면 기본값 그대로, default update 감사 없음', async () => {
    const userId = await withDefault();
    const before = (await auditsOf(userId)).length;
    expect(await actions.deleteLlmCredentialAction({ vendor: 'openai' })).toMatchObject({
      ok: true,
    });
    expect(await defaultsOf(userId)).toEqual({ vendor: 'anthropic', model: 'claude-opus-5-5' });
    expect((await auditsOf(userId)).slice(before).map((row) => row.action)).toEqual([
      'settings.llm_credential.delete',
    ]);
  });

  it('(3) 기본 벤더 키를 교체하면 기본값 그대로 (storeSealed 경로는 정리하지 않음)', async () => {
    const userId = await withDefault();
    const before = (await auditsOf(userId)).length;
    expect(
      await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: makeFakeKey() }),
    ).toMatchObject({ ok: true, data: { status: 'valid' } });
    expect(await defaultsOf(userId)).toEqual({ vendor: 'anthropic', model: 'claude-opus-5-5' });
    const added = (await auditsOf(userId)).slice(before).map((row) => row.action);
    expect(added).toContain('settings.llm_credential.replace');
    expect(added).not.toContain('settings.llm_default.update');
  });

  it('(4) 삭제한 뒤 같은 벤더 키를 다시 등록해도 기본값이 되살아나지 않는다', async () => {
    const userId = await withDefault();
    await actions.deleteLlmCredentialAction({ vendor: 'anthropic' });
    expect(
      await actions.saveLlmCredentialAction({ vendor: 'anthropic', apiKey: makeFakeKey() }),
    ).toMatchObject({ ok: true, data: { status: 'valid' } });
    expect(await defaultsOf(userId)).toEqual({ vendor: null, model: null });
    expect((await viewOf(userId)).defaults).toEqual({
      vendor: null,
      model: null,
      modelReplaced: false,
    });
  });

  it('(5) 정상 키가 하나도 없으면 설정은 빈 상태(키 0건), 챗봇 상태는 missing + MISSING 배너 문구', async () => {
    const userId = await withDefault();
    await actions.deleteLlmCredentialAction({ vendor: 'anthropic' });
    await actions.deleteLlmCredentialAction({ vendor: 'openai' });
    const view = await viewOf(userId);
    // LlmSection 은 credentials 가 비면 NO_CREDENTIAL_NOTICE 를 보인다 (렌더 단언은 settings-page.test.tsx)
    expect(view.credentials).toEqual([]);
    expect(view.defaults).toEqual({ vendor: null, model: null, modelReplaced: false });
    const status = await chatStatus({ db: state.handle!.db, userId, env });
    expect(status.llm).toMatchObject({ status: 'missing', vendor: null, model: null });
    expect('setup' in status ? status.setup?.message : undefined).toBe(MISSING_MESSAGE);
  });

  it('기본값 정리가 실패하면 키 삭제·감사도 롤백된다 (같은 트랜잭션)', async () => {
    const userId = await withDefault();
    const before = await auditsOf(userId);
    // 이 사용자의 기본값을 비우는 UPDATE 만 실패시키는 트리거
    await state.handle!.db.execute(
      sql.raw(`create or replace function i3_fail_clear() returns trigger language plpgsql as $body$
        begin raise exception 'i3 forced failure'; end $body$`),
    );
    await state.handle!.db.execute(
      sql.raw(`create trigger i3_fail_clear before update on user_settings for each row
        when (old.user_id = '${userId}' and new.chat_default_vendor is null)
        execute function i3_fail_clear()`),
    );
    try {
      expect(await actions.deleteLlmCredentialAction({ vendor: 'anthropic' })).toMatchObject({
        ok: false,
      });
    } finally {
      await state.handle!.db.execute(
        sql.raw('drop trigger if exists i3_fail_clear on user_settings'),
      );
      await state.handle!.db.execute(sql.raw('drop function if exists i3_fail_clear()'));
    }
    const rows = await queryRows<{ n: number }>(
      state.handle!.db,
      sql`select count(*)::int n from user_llm_credentials where user_id = ${userId} and vendor = 'anthropic'`,
    );
    expect(rows[0]!.n).toBe(1);
    expect(await defaultsOf(userId)).toEqual({ vendor: 'anthropic', model: 'claude-opus-5-5' });
    expect(await auditsOf(userId)).toEqual(before);
  });
});

describe('접근 (AC-212)', () => {
  it('비로그인 Settings Action 직접 호출 → UNAUTHENTICATED 봉투, DB 무변경', async () => {
    as(undefined);
    const before = await queryRows<{ n: number }>(
      state.handle!.db,
      sql`select count(*)::int n from user_llm_credentials`,
    );
    for (const call of [
      () => actions.saveLlmCredentialAction({ vendor: 'openai', apiKey: makeFakeKey() }),
      () => actions.verifyLlmCredentialAction({ vendor: 'openai' }),
      () => actions.deleteLlmCredentialAction({ vendor: 'openai' }),
      () => actions.updateChatDefaultsAction({ vendor: 'openai', model: 'gpt-6.1-sol' }),
    ]) {
      expect(await call()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    }
    const after = await queryRows<{ n: number }>(
      state.handle!.db,
      sql`select count(*)::int n from user_llm_credentials`,
    );
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
