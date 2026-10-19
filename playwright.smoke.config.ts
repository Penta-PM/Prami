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
  // 현재 스모크는 브라우저 없이 HTTP 만 보내지만, 브라우저 항목이 생겨도 애니메이션 때문에 흔들리지 않게 E2E 와 같은 설정을 둔다
  // (Motion 도입 스펙 §3.6). 서버는 이 설정이 띄우지 않으므로(NEXT_PUBLIC_MOTION_DISABLED 는 빌드 시 인라인) env 는 여기 두지 않는다
  use: { reducedMotion: 'reduce' },
});
