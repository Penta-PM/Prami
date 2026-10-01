import { defineConfig } from '@playwright/test';

/**
 * preview·프로덕션 스모크 (PRAMI-003 §4.3.10, AC-361) — `pnpm smoke`.
 * 대상: `SMOKE_URL`(또는 `PREVIEW_URL`). 서버를 띄우지 않고, 브라우저 없이 비인증 HTTP 요청만 보낸다(Playwright 러너·리포트만 사용).
 * 로컬 preview 모의(프로덕션 빌드 + VERCEL_ENV=preview)는 `pnpm smoke:local` 이 서버를 띄운 뒤 이 설정으로 실행한다.
 */
export default defineConfig({
  testDir: 'tests/smoke',
  testMatch: /.*\.smoke\.ts$/,
  // 8항목은 순서가 있다(rate limit 이 헬스 버킷을 소진하므로 마지막) — 한 파일·한 워커·순차
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
});
