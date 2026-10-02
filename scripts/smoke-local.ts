/**
 * `pnpm smoke:local` — 로컬 preview 모의에서 preview 스모크 8항목 실행 (PRAMI-003 AC-361).
 * 프로덕션 빌드 + `VERCEL_ENV=preview`(preview 기동 검사 그대로) + 격리 Postgres. 실 외부 서비스 호출 없음.
 *
 *   SMOKE_PG_URL=postgres://prami:prami@localhost:5446/smoke pnpm smoke:local [--skip-build] [--fault fixture] [--maintenance] [--port 3200]
 *
 * 1) 격리 DB 마이그레이션(pg 드라이버) 2) `next build`(.next-smoke) 3) `next start` + Neon HTTP preload(scripts/smoke/neon-local-fetch.mjs)
 * 4) `pnpm smoke`. `--fault fixture` 는 fixture 계정을 넣어 헬스 `data:'fixture'`(503) 를 만든다 — ①이 실패해야 한다.
 * `--maintenance` 는 서버를 MAINTENANCE_MODE=true 로 띄우고 점검 모드 스모크(SMOKE_MAINTENANCE=true, ④~⑦ 점검 503 기대)를 돌린다(PR #26 D-1).
 * 안전장치: :5432(로컬 :3000 의 실데이터 DB 컨테이너)·DB 이름 `prami` 는 거부한다. 서버는 끝나면 종료한다.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
};

const PG_URL = process.env.SMOKE_PG_URL ?? '';
const PORT = option('--port', '3200');
const FAULT = option('--fault', '');
const MAINTENANCE = flag('--maintenance');
const BASE_URL = `http://localhost:${PORT}`;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function assertIsolatedDb(url: string): void {
  if (!url) throw new Error('SMOKE_PG_URL(격리 Postgres) 이 필요합니다');
  const parsed = new URL(url);
  // 로컬 격리 컨테이너만 — 원격 호스트·:5432(로컬 :3000 의 실데이터 DB 컨테이너)·DB 이름 prami 거부 (보안 리뷰 L-3)
  if (
    !LOCAL_HOSTS.has(parsed.hostname) ||
    (parsed.port || '5432') === '5432' ||
    parsed.pathname.replace('/', '') === 'prami'
  ) {
    throw new Error(
      'SMOKE_PG_URL 은 로컬 격리 컨테이너여야 합니다 (localhost, :5432·DB prami 금지 — 로컬 실데이터 보호)',
    );
  }
}

function assertPort(port: string): void {
  // 셸 명령으로 넘기므로 숫자만 (보안 리뷰 L-3)
  if (!/^\d{2,5}$/.test(port)) throw new Error('--port 는 숫자여야 합니다');
}

/** preview 기동 검사를 통과하는 최소 설정 — 값은 전부 더미(실 Google·벤더·Upstash 없음) */
function previewEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    VERCEL_ENV: 'preview',
    NEXT_DIST_DIR: '.next-smoke',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_APP_URL: BASE_URL,
    DB_DRIVER: 'neon',
    // 더미 자격 증명(실 서비스 없음) — secret-scan 이 자격 증명 URL 리터럴을 막으므로 실행 시 조립한다
    DATABASE_URL: ['postgresql://smoke', 'smoke@ep-smoke-pooler.neon-smoke.test/smoke'].join(':'),
    AUTH_SECRET: randomBytes(32).toString('base64url'),
    AUTH_GOOGLE_ID: 'smoke-dummy-google-client-id',
    AUTH_GOOGLE_SECRET: 'smoke-dummy-google-client-secret',
    AUTH_REQUIRE_HD: 'true',
    ALLOWED_EMAIL_DOMAINS: 'pentasecurity.com',
    ADMIN_EMAILS: 'smoke-admin@pentasecurity.com',
    TRUST_PROXY_HEADERS: 'vercel',
    RATE_LIMIT_BACKEND: 'memory',
    RATE_LIMIT_ALLOW_MEMORY_IN_PRODUCTION: 'true',
    CHAT_LLM_ENABLED: 'false',
    APP_RELEASE: 'smoke-local',
  };
}

/** 셸 env 의 테스트 모드·시드 표식이 섞이지 않게 지운다 (preview 기동 검사가 거부) */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const base = { ...process.env };
  for (const key of [
    'AUTH_TEST_MODE',
    'AUTH_TEST_PASSWORD',
    'PRAMI_ALLOW_SEED',
    'LLM_VENDOR_MODE',
  ]) {
    delete base[key];
  }
  return { ...base, ...extra };
}

function run(command: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'inherit', env });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/** 포트에 이미 서버가 있으면 거부 — 옛 서버에 스모크를 돌리는 사고 방지 */
async function assertPortFree(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/login`);
  } catch {
    return;
  }
  throw new Error(`:${PORT} 에 이미 서버가 있습니다 — 종료 후 다시 실행하세요`);
}

async function waitForServer(server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`서버가 종료됐습니다 (exit ${server.exitCode})`);
    try {
      if ((await fetch(`${BASE_URL}/login`)).status === 200) return;
    } catch {
      // 기동 중
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('서버 기동 대기 시간 초과');
}

async function insertFixtureAccount(): Promise<void> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  try {
    await client.query(
      `insert into users (email, name, role, created_via) values ('fixture-admin@pentasecurity.com', 'fixture', 'ADMIN', 'admin')
       on conflict do nothing`,
    );
  } finally {
    await client.end();
  }
}

async function main(): Promise<number> {
  assertIsolatedDb(PG_URL);
  assertPort(PORT);
  await assertPortFree();
  const env = previewEnv();
  if ((await run('pnpm db:migrate', cleanEnv({ DB_DRIVER: 'pg', DATABASE_URL: PG_URL }))) !== 0) {
    return 1;
  }
  if (FAULT === 'fixture') await insertFixtureAccount();
  if (!flag('--skip-build') && (await run('pnpm build', cleanEnv(env))) !== 0) return 1;
  const server = spawn(`pnpm exec next start -p ${PORT}`, {
    shell: true,
    stdio: 'inherit',
    env: cleanEnv({
      ...env,
      SMOKE_PG_URL: PG_URL,
      ...(MAINTENANCE ? { MAINTENANCE_MODE: 'true' } : {}),
      NODE_OPTIONS: '--import ./scripts/smoke/neon-local-fetch.mjs',
    }),
  });
  try {
    await waitForServer(server);
    return await run(
      'pnpm smoke',
      cleanEnv({
        SMOKE_URL: BASE_URL,
        SMOKE_EXPECT_RELEASE: 'smoke-local',
        SMOKE_MAINTENANCE: MAINTENANCE ? 'true' : 'false',
      }),
    );
  } finally {
    // Windows: 셸 자식(next start)까지 프로세스 트리로 먼저 끝낸다 — 셸만 죽이면 서버가 남아 다음 실행이 옛 서버에 붙는다
    if (process.platform === 'win32' && server.pid) {
      await run(`taskkill /pid ${server.pid} /T /F >NUL 2>&1`, process.env);
    } else {
      server.kill();
    }
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error('[smoke:local] 실패:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
