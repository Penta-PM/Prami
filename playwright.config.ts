import { defineConfig, devices } from '@playwright/test';

// 개발 서버(3000)와 충돌하지 않도록 E2E 는 별도 포트를 쓴다
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

/**
 * E2E 스모크. `pnpm build` 후 `pnpm test:e2e` 로 실행한다 (webServer 가 `next start` 를 띄움).
 * 로컬에서 이미 서버가 떠 있으면 재사용한다.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    locale: 'ko-KR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
