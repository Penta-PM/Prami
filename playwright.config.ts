import { defineConfig, devices } from '@playwright/test';

// 개발 서버(3000)와 충돌하지 않도록 E2E 는 별도 포트·별도 산출물 폴더(.next-e2e)를 쓴다
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
/** 테스트 모드 없는 로컬 실로그인 설정 서버 (PRAMI-003 §4.9.4 T-1, AC-335) — /login 렌더만 본다(실 Google 호출 없음) */
const REAL_LOGIN_PORT = Number(process.env.E2E_REAL_LOGIN_PORT ?? PORT + 1);
export const REAL_LOGIN_BASE_URL = `http://localhost:${REAL_LOGIN_PORT}`;
const isCI = Boolean(process.env.CI);

/**
 * E2E 는 Docker/CI Postgres(DB_DRIVER=pg) + AUTH_TEST_MODE 로 실행한다 (§4.9.2 E2E 열).
 * AUTH_TEST_MODE 는 production 빌드에서 거부되므로(AC-07) `next build/start` 가 아니라 `next dev` 로 띄운다.
 * globalSetup 이 대상 DB 에 마이그레이션·시드를 적용한다.
 */
export const E2E_ENV = {
  DB_DRIVER: 'pg',
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://prami:prami@localhost:5432/prami_e2e',
  AUTH_SECRET: 'e2e-only-secret-not-for-production-0123456789',
  AUTH_TEST_MODE: 'true',
  AUTH_TEST_PASSWORD: 'e2e-test-password',
  ALLOWED_EMAIL_DOMAINS: 'pentasecurity.com',
  ADMIN_EMAILS: 'fixture-admin@pentasecurity.com',
  AUTH_AUTO_PROVISION: 'true',
  // PRAMI-003 §4.9.3 L2: globalSetup 의 pnpm seed 는 이 표식이 있는 격리 DB 에서만 실행된다
  PRAMI_ALLOW_SEED: '1',
  AUTH_GOOGLE_ID: '',
  AUTH_GOOGLE_SECRET: '',
  NEXT_DIST_DIR: '.next-e2e',
  NEXT_TELEMETRY_DISABLED: '1',
  // PRAMI-002: E2E 는 가짜 벤더 검증기 + 코드로 만든 테스트 KEK (저장소에 KEK 리터럴 없음)
  LLM_CREDENTIALS_KEKS: `1:${Buffer.alloc(32, 'test-kek-e2e').toString('base64')}`,
  LLM_CREDENTIALS_ACTIVE_KEK: '1',
  LLM_VENDOR_MODE: 'fake',
  // 키 검증 리미터(사용자별 분당, 메모리)는 dev 서버 한 프로세스에서 스펙 간에 누적된다 — 여러 스펙이 같은 픽스처 사용자로
  // 1분 안에 키를 저장하면 RATE_LIMITED 로 실패한다. unit env 와 같은 관례로 E2E 에서는 넉넉히 둔다(리미터 동작은 단위 테스트가 검증).
  // 운영 기본값(src/env.ts 5)은 그대로 (Linux 하이드레이션 수정 스펙 §8)
  LLM_VERIFY_PER_MIN: '1000',
  E2E_SERVER_LOG: '.e2e-logs/next-dev.log',
} as const;

/**
 * T-1 설정: AUTH_TEST_MODE·AUTH_TEST_PASSWORD 없음, AUTH_GOOGLE_ID/SECRET 만 더미 값.
 * 같은 격리 DB 를 쓰지만 로그인하지 않는다(렌더만). 산출물 폴더를 따로 써서 테스트 모드 서버와 캐시가 겹치지 않게 한다.
 */
const E2E_BASE_ENV: Record<string, string> = Object.fromEntries(
  Object.entries(E2E_ENV).filter(
    ([key]) => key !== 'AUTH_TEST_MODE' && key !== 'AUTH_TEST_PASSWORD',
  ),
);
export const REAL_LOGIN_ENV = {
  ...E2E_BASE_ENV,
  AUTH_GOOGLE_ID: 'e2e-dummy-google-client-id',
  AUTH_GOOGLE_SECRET: 'e2e-dummy-google-client-secret',
  NEXT_DIST_DIR: '.next-e2e-real-login',
  E2E_SERVER_LOG: '.e2e-logs/next-dev-real-login.log',
};

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // 테스트가 같은 DB 의 사용자·감사 로그를 바꾸므로 순차 실행한다
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    locale: 'ko-KR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // 래퍼가 서버 출력을 E2E_SERVER_LOG 에도 남긴다 — settings-llm.spec 이 dev 로그에 키 평문 0건을 검사 (QA H-1)
      command: `pnpm exec tsx scripts/e2e-dev-server.ts ${PORT}`,
      url: `${BASE_URL}/login`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: { ...E2E_ENV },
    },
    {
      command: `pnpm exec tsx scripts/e2e-dev-server.ts ${REAL_LOGIN_PORT}`,
      url: `${REAL_LOGIN_BASE_URL}/login`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: { ...REAL_LOGIN_ENV },
    },
  ],
});
