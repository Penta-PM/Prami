import { defineConfig, devices } from '@playwright/test';

// 개발 서버(3000)와 충돌하지 않도록 E2E 는 별도 포트·별도 산출물 폴더(.next-e2e)를 쓴다
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
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
  AUTH_GOOGLE_ID: '',
  AUTH_GOOGLE_SECRET: '',
  NEXT_DIST_DIR: '.next-e2e',
  NEXT_TELEMETRY_DISABLED: '1',
  // PRAMI-002: E2E 는 가짜 벤더 검증기 + 코드로 만든 테스트 KEK (저장소에 KEK 리터럴 없음)
  LLM_CREDENTIALS_KEKS: `1:${Buffer.alloc(32, 'test-kek-e2e').toString('base64')}`,
  LLM_CREDENTIALS_ACTIVE_KEK: '1',
  LLM_VENDOR_MODE: 'fake',
  E2E_SERVER_LOG: '.e2e-logs/next-dev.log',
} as const;

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
  webServer: {
    // 래퍼가 서버 출력을 E2E_SERVER_LOG 에도 남긴다 — settings-llm.spec 이 dev 로그에 키 평문 0건을 검사 (QA H-1)
    command: `pnpm exec tsx scripts/e2e-dev-server.ts ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    env: { ...E2E_ENV },
  },
});
