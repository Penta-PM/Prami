// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveMigrationConnection } from '@/db/migrate';
import { isRemoteDbTarget, targetHostViolation } from '@/lib/db-host';

/**
 * PRAMI-003 §4.3.4 스크립트 가드 (AC-323·AC-324·AC-327). CLI 는 실제로 띄워 exit code·출력을 본다.
 * 거부 경로는 DB 연결 전에 끝나므로 DB 가 없어도 된다(원격 호스트는 존재하지 않는 이름).
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const REMOTE = 'postgres://u:pw@example-remote-host:5432/prami';

/** 부모 테스트 환경(DB_DRIVER=pglite 등)을 지우고 지정한 env 만 준다 */
function runScript(script: string, args: string[], env: Record<string, string>) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(DB_DRIVER|DATABASE_URL|PGLITE_DATA_DIR|VERCEL_ENV|NODE_ENV|PRAMI_ALLOW_SEED)$/.test(
          key,
        ),
    ),
  );
  const result = spawnSync(
    process.execPath,
    [TSX_CLI, '--conditions=react-server', path.join('scripts', script), ...args],
    {
      cwd: ROOT,
      env: { ...base, ...env } as NodeJS.ProcessEnv,
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('원격 대상 판정 · --target-host (§4.3.4 ②)', () => {
  it('neon·원격 호스트는 원격, pglite·로컬 호스트는 로컬', () => {
    expect(isRemoteDbTarget({ DB_DRIVER: 'neon', DATABASE_URL: REMOTE })).toBe(true);
    expect(isRemoteDbTarget({ DB_DRIVER: 'pg', DATABASE_URL: REMOTE })).toBe(true);
    expect(isRemoteDbTarget({ DB_DRIVER: 'pg', DATABASE_URL: 'postgres://a:b@localhost/x' })).toBe(
      false,
    );
    expect(isRemoteDbTarget({})).toBe(false);
  });

  it('원격이면 --target-host 가 필요하고 실제 호스트와 같아야 한다', () => {
    const remote = { DB_DRIVER: 'pg', DATABASE_URL: REMOTE };
    expect(targetHostViolation(remote, undefined)).toBe('missing');
    expect(targetHostViolation(remote, '  ')).toBe('missing');
    expect(targetHostViolation(remote, 'other-host')).toBe('mismatch');
    expect(targetHostViolation(remote, 'Example-Remote-Host')).toBeNull();
    expect(targetHostViolation({ DB_DRIVER: 'pglite' }, undefined)).toBeNull();
  });
});

describe('마이그레이션 연결 (AC-327)', () => {
  it('DATABASE_URL_UNPOOLED 가 있으면 우선, 로그용은 호스트만', () => {
    const connection = resolveMigrationConnection({
      DB_DRIVER: 'neon',
      DATABASE_URL: 'postgresql://pooled:pw@ep-a-pooler.example.neon.tech/db',
      DATABASE_URL_UNPOOLED: 'postgresql://direct:pw@ep-a.example.neon.tech/db',
    });
    expect(connection).toMatchObject({
      via: 'unpooled',
      host: 'ep-a.example.neon.tech',
      warning: null,
    });
    expect(JSON.stringify({ host: connection.host, warning: connection.warning })).not.toMatch(
      /pw/,
    );
  });

  it('없으면 DATABASE_URL + 경고(neon), 로컬 pg 는 경고 없음, pglite 는 연결 없음', () => {
    const neon = resolveMigrationConnection({
      DB_DRIVER: 'neon',
      DATABASE_URL: 'postgresql://pooled:pw@ep-a-pooler.example.neon.tech/db',
    });
    expect(neon.via).toBe('pooled');
    expect(neon.warning).toMatch(/DATABASE_URL_UNPOOLED/);
    expect(neon.warning).not.toMatch(/:pw@/);
    expect(
      resolveMigrationConnection({ DB_DRIVER: 'pg', DATABASE_URL: 'postgres://a:b@localhost/x' })
        .warning,
    ).toBeNull();
    expect(resolveMigrationConnection({})).toMatchObject({ via: 'none', url: undefined });
  });
});

describe('CLI 가드 (AC-323·AC-324)', { timeout: 120_000 }, () => {
  it('import:source 경로 인자 없음 → 사용법 오류 (로컬 기본 경로 없음)', () => {
    const run = runScript('import-source.ts', [], { DB_DRIVER: 'pglite' });
    expect(run.status).toBe(1);
    expect(run.output).toMatch(/파일 경로를 지정하세요/);
  });

  it('import:source 원격 대상에 --target-host 없음·불일치 → 거부 (연결 시도 전)', () => {
    const env = { DB_DRIVER: 'pg', DATABASE_URL: REMOTE };
    const missing = runScript('import-source.ts', ['x.xlsx'], env);
    expect(missing.status).toBe(1);
    expect(missing.output).toMatch(/--target-host <연결 호스트> 를 지정해야/);
    const mismatch = runScript('import-source.ts', ['x.xlsx', '--target-host', 'wrong-host'], env);
    expect(mismatch.status).toBe(1);
    expect(mismatch.output).toMatch(/실제 연결 호스트와 다릅니다/);
    expect(`${missing.output}${mismatch.output}`).not.toContain('pw@');
  });

  it('seed: neon·원격 호스트·로컬 미허용 → exit 1', () => {
    const neon = runScript('seed.ts', [], {
      DB_DRIVER: 'neon',
      DATABASE_URL: REMOTE,
      PRAMI_ALLOW_SEED: '1',
    });
    expect(neon.status).toBe(1);
    expect(neon.output).toMatch(/DB_DRIVER=neon/);
    const remote = runScript('seed.ts', [], {
      DB_DRIVER: 'pg',
      DATABASE_URL: REMOTE,
      PRAMI_ALLOW_SEED: '1',
    });
    expect(remote.status).toBe(1);
    expect(remote.output).toMatch(/원격 DB/);
    const local = runScript('seed.ts', [], { DB_DRIVER: 'pglite' });
    expect(local.status).toBe(1);
    expect(local.output).toMatch(/PRAMI_ALLOW_SEED=1/);
  });

  it('fixtures: VERCEL_ENV 조건에서 거부', () => {
    const run = runScript('make-fixtures.ts', [], { VERCEL_ENV: 'preview', PRAMI_ALLOW_SEED: '1' });
    expect(run.status).toBe(1);
    expect(run.output).toMatch(/VERCEL_ENV/);
  });

  it('data:verify --target preview|production: --target-host 누락·불일치 → 실행 거부 (AC-332 ④)', () => {
    const env = { DB_DRIVER: 'pg', DATABASE_URL: REMOTE };
    const missing = runScript('data-verify.ts', ['--target', 'preview'], env);
    expect(missing.status).toBe(1);
    expect(missing.output).toMatch(/--target-host <연결 호스트> 를 지정해야/);
    const mismatch = runScript(
      'data-verify.ts',
      ['--target', 'production', '--target-host', 'other-host'],
      env,
    );
    expect(mismatch.status).toBe(1);
    expect(mismatch.output).toMatch(/실제 연결 호스트와 다릅니다/);
    // 로컬 호스트 DB 라도 원격 target 이면 --target-host 를 요구한다
    const localAsPreview = runScript('data-verify.ts', ['--target', 'preview'], {
      DB_DRIVER: 'pg',
      DATABASE_URL: 'postgres://prami:prami@localhost:5432/prami',
    });
    expect(localAsPreview.status).toBe(1);
    const badTarget = runScript('data-verify.ts', ['--target', 'staging'], { DB_DRIVER: 'pglite' });
    expect(badTarget.output).toMatch(/--target 는 local\|preview\|production/);
  });
});
