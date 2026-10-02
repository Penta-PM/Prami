// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDb, type Db, type DbHandle } from '@/db';
import { DEFAULT_MIGRATIONS_FOLDER, migrateDb } from '@/db/migrate';
import { checkHealth } from '@/server/ops/health';
import { releaseInfo } from '@/server/ops/release';
import {
  BUNDLED_JOURNAL,
  compareSchema,
  latestJournalEntry,
  readSchemaState,
  type MigrationJournal,
} from '@/server/ops/schema-version';
import { runStartupChecks } from '@/server/ops/startup-checks';

import { insertUser } from '../../helpers/pglite';

/**
 * PRAMI-003 §4.3.6·§4.3.10·§4.9.3 L4 — AC-326(스키마 behind/ahead), AC-330 ①(헬스 키·503), AC-334(fixture 데이터 검사).
 */
const temps: string[] = [];
let full: DbHandle;
let behind: DbHandle;

/** 저널 마지막 항목을 뺀 마이그레이션 폴더 — "하나 덜 적용한 DB" 를 만든다 */
function folderWithoutLast(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'prami-mig-'));
  temps.push(dir);
  cpSync(DEFAULT_MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal;
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }));
  return dir;
}

const JOURNAL_MINUS_LAST: MigrationJournal = {
  entries: BUNDLED_JOURNAL.entries.slice(0, -1),
};

/** execute 호출 수를 세는 래퍼 — "조회하지 않는다" 검사용 */
function countingDb(db: Db) {
  let executes = 0;
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'execute') {
        return (...args: Parameters<Db['execute']>) => {
          executes += 1;
          return target.execute(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { db: proxy, executes: () => executes };
}

beforeAll(async () => {
  full = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
  await migrateDb(full);
  behind = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
  await migrateDb(behind, { migrationsFolder: folderWithoutLast() });
});

afterAll(async () => {
  await full.close();
  await behind.close();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('스키마 버전 비교 (AC-326)', () => {
  it('compareSchema 순수 판정', () => {
    expect(compareSchema(10, 10)).toBe('ok');
    expect(compareSchema(10, 9)).toBe('behind');
    expect(compareSchema(10, null)).toBe('behind');
    expect(compareSchema(9, 10)).toBe('ahead');
    expect(compareSchema(null, null)).toBe('ok');
    expect(compareSchema(null, 1)).toBe('ahead');
  });

  it('번들 저널 최신 = 0007, DB 최신이면 ok · 하나 덜 적용하면 behind · 저널이 짧으면(구버전 앱) ahead', async () => {
    expect(latestJournalEntry(BUNDLED_JOURNAL)?.tag).toBe('0007_llm_credential_expiry');
    expect(await readSchemaState(full.db)).toBe('ok');
    expect(await readSchemaState(behind.db)).toBe('behind');
    expect(await readSchemaState(full.db, JOURNAL_MINUS_LAST)).toBe('ahead');
  });

  it('마이그레이션 테이블이 없는 빈 DB 는 behind', async () => {
    const empty = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
    try {
      expect(await readSchemaState(empty.db)).toBe('behind');
    } finally {
      await empty.close();
    }
  });
});

describe('/api/health 판정 (AC-330 ①·AC-326·AC-334)', () => {
  const local = { APP_RELEASE: 'abc1234' };

  it('최신 DB → 200, 키는 ok·release·db·schema·data 뿐', async () => {
    const result = await checkHealth({ getDb: async () => full.db, source: local });
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual(['data', 'db', 'ok', 'release', 'schema']);
    expect(result.body).toEqual({
      ok: true,
      release: 'abc1234',
      db: 'ok',
      schema: 'ok',
      data: 'ok',
    });
  });

  it('하나 덜 적용한 DB → 503 schema:behind', async () => {
    const result = await checkHealth({ getDb: async () => behind.db, source: local });
    expect(result).toEqual({
      status: 503,
      body: { ok: false, release: 'abc1234', db: 'ok', schema: 'behind', data: 'ok' },
    });
  });

  it('DB 가 앞섬(저널에서 마지막을 뺀 앱) → 200 schema:ahead', async () => {
    const result = await checkHealth({
      getDb: async () => full.db,
      source: local,
      journal: JOURNAL_MINUS_LAST,
    });
    expect(result.status).toBe(200);
    expect(result.body.schema).toBe('ahead');
  });

  it('DB 연결 실패(차단) → 503 db:error', async () => {
    const result = await checkHealth({
      getDb: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      source: local,
    });
    expect(result).toEqual({
      status: 503,
      body: { ok: false, release: 'abc1234', db: 'error', schema: 'unknown', data: 'unknown' },
    });
  });

  it('자체 호스팅 production(NODE_ENV·APP_ENV=production)도 fixture 를 검사한다', async () => {
    await insertUser(full, { email: 'fixture-selfhost@pentasecurity.com', role: 'USER' });
    const result = await checkHealth({
      getDb: async () => full.db,
      source: { NODE_ENV: 'production', APP_ENV: 'production' },
    });
    expect(result).toMatchObject({ status: 503, body: { data: 'fixture' } });
    await full.db.execute(
      sql`delete from users where email = 'fixture-selfhost@pentasecurity.com'`,
    );
  });

  it('VERCEL_ENV=preview + fixture 계정 1개 → 503 data:fixture · 0개 → 200 · VERCEL_ENV 없으면 조회 없이 ok', async () => {
    const preview = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'def5678' };
    const clean = countingDb(full.db);
    const okResult = await checkHealth({ getDb: async () => clean.db, source: preview });
    expect(okResult).toMatchObject({ status: 200, body: { data: 'ok', release: 'def5678' } });

    await insertUser(full, { email: 'fixture-admin@pentasecurity.com', role: 'ADMIN' });
    const dirty = await checkHealth({ getDb: async () => full.db, source: preview });
    expect(dirty).toEqual({
      status: 503,
      body: { ok: false, release: 'def5678', db: 'ok', schema: 'ok', data: 'fixture' },
    });

    const localCount = countingDb(full.db);
    const localResult = await checkHealth({ getDb: async () => localCount.db, source: {} });
    expect(localResult).toMatchObject({ status: 200, body: { data: 'ok', release: 'dev' } });
    // select 1 + 스키마 조회 2 = 3, preview 는 fixture 조회 1 이 더해진다
    expect(localCount.executes()).toBe(3);
    expect(clean.executes()).toBe(4);
  });
});

describe('기동 점검 로그 (AC-326·AC-334)', () => {
  it('behind → error db.schema_behind(태그만), ahead → warn db.schema_ahead', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await runStartupChecks(behind.db, {})).toEqual({
      schema: 'behind',
      fixtureAccounts: null,
    });
    expect(JSON.parse(String(error.mock.calls[0]![0]))).toMatchObject({
      level: 'error',
      event: 'db.schema_behind',
      expected: '0007_llm_credential_expiry',
    });
    expect(await runStartupChecks(full.db, {}, JOURNAL_MINUS_LAST)).toMatchObject({
      schema: 'ahead',
    });
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ event: 'db.schema_ahead' });
    error.mockRestore();
    warn.mockRestore();
  });

  it('VERCEL_ENV 가 있고 fixture 계정이 있으면 error db.fixture_accounts_present(개수만, 1회)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runStartupChecks(full.db, { VERCEL_ENV: 'preview' });
    expect(result.fixtureAccounts).toBeGreaterThanOrEqual(1);
    const lines = error.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: 'db.fixture_accounts_present',
      count: result.fixtureAccounts,
    });
    expect(JSON.stringify(lines)).not.toMatch(/@pentasecurity\.com/);
    error.mockRestore();
  });
});

describe('releaseInfo · 로그 필드 (§4.3.8)', () => {
  it('APP_RELEASE → VERCEL_GIT_COMMIT_SHA → dev, env 는 VERCEL_ENV 또는 local', () => {
    expect(releaseInfo({ APP_RELEASE: 'r1', VERCEL_GIT_COMMIT_SHA: 'sha' })).toEqual({
      release: 'r1',
      env: 'local',
    });
    expect(releaseInfo({ VERCEL_GIT_COMMIT_SHA: 'sha', VERCEL_ENV: 'preview' })).toEqual({
      release: 'sha',
      env: 'preview',
    });
    expect(releaseInfo({ APP_RELEASE: ' ' })).toEqual({ release: 'dev', env: 'local' });
  });

  it('PR-4 리뷰 H1: 런타임 APP_RELEASE 가 없으면 빌드 때 고정한 값(커밋 SHA)이 Vercel SHA 보다 우선', () => {
    expect(releaseInfo({ VERCEL_GIT_COMMIT_SHA: 'vercel-sha' }, 'build-sha')).toEqual({
      release: 'build-sha',
      env: 'local',
    });
    expect(releaseInfo({ APP_RELEASE: 'runtime' }, 'build-sha').release).toBe('runtime');
    expect(releaseInfo({ VERCEL_GIT_COMMIT_SHA: 'vercel-sha' }, '').release).toBe('vercel-sha');
  });

  it('모든 구조화 로그 줄에 release·env 가 있다', async () => {
    const { formatLog } = await import('@/server/log');
    expect(formatLog('info', 'x', { a: 1 })).toMatchObject({
      release: expect.any(String),
      env: expect.any(String),
      a: 1,
    });
  });
});
