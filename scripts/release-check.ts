/**
 * `pnpm release:check env|schema|data|headers [--target local|preview|production] [--url <URL>] [--target-host <호스트>] [--names-file <파일>]`
 * — 배포 전 체크리스트 자동 항목 (PRAMI-003 §4.3.12, docs/deploy/checklist.md C-3·C-5·C-7·C-8·C-9, AC-365).
 * - env: local 은 .env.local·.env 파일의 **키 이름**, preview·production 은 `vercel env ls <target>`(Vercel CLI 로그인 필요)
 *   또는 `--names-file`(한 줄에 이름 하나) — §4.3.2 필수 키 누락·금지 키 존재를 본다. 값은 읽지 않는다.
 * - schema: `--url` 이 있으면 그 앱의 `/api/health` schema, 없으면 직접 연결 DB(DB_DRIVER·DATABASE_URL) 의 저널 대비 상태
 * - data: `pnpm data:verify --fresh --target <t> [--target-host <호스트>]` (원격 가드는 data:verify 가 한다)
 * - headers: `--url`(기본 NEXT_PUBLIC_APP_URL) 의 /login 응답 보안 헤더 6종 + CSP nonce
 * 결과는 판정 표(이름·코드만). 실패 항목이 있으면 exit 1.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { loadEnvConfig } from '@next/env';

import {
  formatRows,
  parseReleaseCheckArgs,
  parseVercelEnvNames,
  runReleaseCheck,
  type ReleaseCheckArgs,
  type ReleaseCheckDeps,
} from '../src/server/ops/release-check';

function exec(command: string, capture: boolean): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function envNames(args: ReleaseCheckArgs): Promise<Set<string>> {
  if (args.namesFile) {
    return new Set(
      readFileSync(args.namesFile, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }
  if (args.target === 'local') {
    const { loadedEnvFiles } = loadEnvConfig(process.cwd(), false, {
      info: () => {},
      error: () => {},
    });
    return new Set(loadedEnvFiles.flatMap((file) => Object.keys(file.env)));
  }
  const { code, stdout } = await exec(`vercel env ls ${args.target}`, true);
  if (code !== 0) throw new Error('vercel env ls 실패');
  return parseVercelEnvNames(stdout);
}

const deps: ReleaseCheckDeps = {
  envNames,
  schemaState: async () => {
    loadEnvConfig(process.cwd());
    const { createDb } = await import('../src/db');
    const { readSchemaState } = await import('../src/server/ops/schema-version');
    const handle = await createDb();
    try {
      return await readSchemaState(handle.db);
    } finally {
      await handle.close();
    }
  },
  dataVerify: async (args) => {
    const host = args.targetHost ? ` --target-host ${args.targetHost}` : '';
    return (await exec(`pnpm data:verify --fresh --target ${args.target}${host}`, false)).code;
  },
  fetch: (url, init) => fetch(url, init),
  defaultUrl: () => {
    loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
    return process.env.NEXT_PUBLIC_APP_URL;
  },
};

async function main(): Promise<number> {
  const args = parseReleaseCheckArgs(process.argv.slice(2));
  const result = await runReleaseCheck(args, deps);
  console.log(formatRows(`release:check ${args.command} (--target ${args.target})`, result.rows));
  console.log(result.ok ? '\n결과: PASS' : '\n결과: FAIL');
  return result.ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error('[release:check]', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
