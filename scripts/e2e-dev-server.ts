/**
 * E2E 용 `next dev` 래퍼 (PRAMI-002 QA H-1). 서버 stdout/stderr 를 그대로 내보내면서 `E2E_SERVER_LOG` 파일에도 남긴다.
 * E2E(`tests/e2e/settings-llm.spec.ts`)가 이 로그에서 더미 키를 grep 해 **개발 모드 터미널 로그에 키 평문이 0건**임을 증명한다
 * (Next 는 dev 에서 Server Function 인자를 기본 로깅 — next.config `logging.serverFunctions: false` 로 끈다).
 *
 * 사용: tsx scripts/e2e-dev-server.ts <port>
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const port = process.argv[2] ?? '3100';
const logPath = path.resolve(process.env.E2E_SERVER_LOG ?? '.e2e-logs/next-dev.log');
mkdirSync(path.dirname(logPath), { recursive: true });
const log = createWriteStream(logPath, { flags: 'w' });

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'dev', '-p', port], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  log.write(chunk);
});
child.stderr.on('data', (chunk: Buffer) => {
  process.stderr.write(chunk);
  log.write(chunk);
});

const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  log.end();
  process.exit(code ?? 0);
});
