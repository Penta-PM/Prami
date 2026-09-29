// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { scanFiles, scanText, trackedFiles } from '../../../scripts/secret-scan';

/**
 * AC-96 비밀값 grep: 저장소는 깨끗하고, 위반 파일을 주입하면 CLI 가 실패(exit 1)한다.
 * 이 파일 자체가 걸리지 않도록 위반 문자열은 조각을 이어 붙여 런타임에 만든다.
 */
const join = (...parts: string[]) => parts.join('');
const REMOTE_URL = join(
  'postgres',
  'ql://neondb_owner:',
  'Ab3xY9qLm2',
  '@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb',
);
const AUTH_SECRET_LINE = join('AUTH_', 'SECRET=', 'q8Zr4TtLw2pVn6Yc');
const GOOGLE_SECRET = join('GOC', 'SPX-', 'abcdEFGH1234ijklMNOP');
const GOOGLE_ID = join(
  '123456789012-',
  'abcdefghijklmnopqrstuvwxyz012345',
  '.apps.googleusercontent.com',
);
const NEON_PASSWORD = join('np', 'g_', 'AbCdEf123456');

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('scanText', () => {
  it('원격 DB 자격 증명·AUTH_SECRET 값·Google OAuth 시크릿/ID·Neon 비밀번호를 잡는다', () => {
    const text = [REMOTE_URL, AUTH_SECRET_LINE, GOOGLE_SECRET, GOOGLE_ID, NEON_PASSWORD].join('\n');
    const rules = scanText('leak.env', text).map((finding) => finding.rule);
    expect(rules).toEqual([
      '원격 postgres 자격 증명',
      'AUTH_SECRET 값 대입',
      'Google OAuth 클라이언트 시크릿',
      'Google OAuth 클라이언트 ID',
      'Neon 비밀번호',
    ]);
  });

  it('PR-11a QA L-2: `KEY: value`(YAML·JSON·TS 객체)·따옴표 키·소문자 키도 잡는다', () => {
    const value = join('q8Zr4', 'TtLw2pVn6Yc');
    const lines = [
      join('AUTH_', 'SECRET: "', value, '"'),
      join('  AUTH_', 'SECRET: ', value),
      join('{ "AUTH_', 'SECRET": "', value, '" }'),
      join('const cfg = { AUTH_', "SECRET: '", value, "' };"),
      join('auth_', 'secret=', value),
      join('AUTH_GOOGLE_', 'SECRET: ', value),
    ];
    for (const line of lines) {
      expect(scanText('config.yml', line).map((finding) => finding.rule)).toHaveLength(1);
      expect(scanText('config.ts', line).length).toBeLessThanOrEqual(1);
    }
  });

  it('`KEY: value` 형태여도 테스트 전용·자리표시자 값은 허용', () => {
    const allowed = [
      join('AUTH_', "SECRET: 'e2e-only-secret-not-for-production-0123456789'"),
      join('AUTH_', 'SECRET: ${{ secrets.AUTH_SECRET }}'),
      join('AUTH_', 'SECRET: <발급값>'),
      join('AUTH_', 'SECRET: ""'),
      join('authSecretLength: 32'),
    ].join('\n');
    expect(scanText('ci.yml', allowed)).toEqual([]);
    // 코드 파일: 따옴표 없는 값은 식(스키마 정의 등), 따옴표 값이라도 단어 조합은 가짜
    const code = [
      join('  AUTH_', 'SECRET: z.preprocess(emptyToUndefined, z.string().min(32)),'),
      join('  AUTH_GOOGLE_', 'SECRET: optionalString,'),
      join('  AUTH_GOOGLE_', "SECRET: 'client-secret',"),
    ].join('\n');
    expect(scanText('env.ts', code)).toEqual([]);
    // 같은 코드 파일이라도 따옴표 안 무작위 값은 잡는다
    expect(scanText('env.ts', join('  AUTH_', "SECRET: 'q8Zr4", "TtLw2pVn6Yc',"))).toHaveLength(1);
  });

  it('로컬 docker 기본값·빈 값·자리표시자·가짜 비밀번호는 허용한다', () => {
    const allowed = [
      join('DATABASE_URL=postgres://prami:prami', '@localhost:5432/prami'),
      join('postgres://prami:prami', '@127.0.0.1:5432/prami_e2e'),
      join('postgresql://user:pw', '@ep-test.neon.tech/prami'),
      join('AUTH_', 'SECRET='),
      join('AUTH_', 'SECRET=$(openssl rand -base64 32)'),
      join('AUTH_GOOGLE_', 'SECRET=<Google Cloud 콘솔에서 발급>'),
      "AUTH_SECRET: 'e2e-only-secret-not-for-production-0123456789'",
    ].join('\n');
    expect(scanText('ok.md', allowed)).toEqual([]);
  });
});

describe('저장소 검사', () => {
  it('추적 중인 파일에 비밀값 패턴이 없다', () => {
    const root = process.cwd();
    expect(scanFiles(root, trackedFiles(root))).toEqual([]);
  });

  it('위반 파일을 주입한 git 저장소에서 CLI 가 실패(exit 1)하고, 깨끗하면 0', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'secret-scan-'));
    temps.push(repo);
    const git = (...args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    writeFileSync(path.join(repo, 'README.md'), '# clean\n');
    git('add', '.');
    const script = path.resolve('scripts/secret-scan.ts');
    const run = () =>
      spawnSync(process.execPath, ['--import', 'tsx', script, repo], { encoding: 'utf8' });
    expect(run().status).toBe(0);

    writeFileSync(
      path.join(repo, 'deploy.env'),
      `${AUTH_SECRET_LINE}\nDATABASE_URL=${REMOTE_URL}\n`,
    );
    writeFileSync(
      path.join(repo, 'vercel.yml'),
      `env:\n  ${join('AUTH_', 'SECRET')}: ${join('q8Zr4', 'TtLw2pVn6Yc')}\n`,
    );
    git('add', '.');
    const failed = run();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('deploy.env:1 AUTH_SECRET 값 대입');
    expect(failed.stderr).toContain('deploy.env:2 원격 postgres 자격 증명');
    expect(failed.stderr).toContain('vercel.yml:2 AUTH_SECRET 값 대입');
    // 값 전체를 다시 출력하지 않는다
    expect(failed.stderr).not.toContain('Ab3xY9qLm2');
  }, 60_000);
});
