import { expect, test } from '@playwright/test';

import { runSmokeCheck, SMOKE_CHECKS, smokeContext } from '../../src/server/ops/smoke-checks';

/**
 * preview·프로덕션 스모크 8항목 (PRAMI-003 §4.3.10, AC-361). 판정은 `src/server/ops/smoke-checks.ts`(단위 테스트로 고장 주입 검증).
 * 환경: SMOKE_URL(필수, 또는 PREVIEW_URL) · SMOKE_EXPECT_RELEASE(배포 SHA, 선택) ·
 * SMOKE_BYPASS_SECRET + SMOKE_BYPASS_HOST_PATTERN(배포 보호 우회, 선택 — 패턴에 맞는 호스트에만) ·
 * SMOKE_MAINTENANCE=true(점검 모드 배포 — ④~⑦ 점검 503 기대, 런북 §0.3)
 */
const baseUrl = process.env.SMOKE_URL || process.env.PREVIEW_URL;
const maintenance = process.env.SMOKE_MAINTENANCE ?? '';

// 한 워커에서 선언 순서대로 실행한다(rate limit 이 마지막). 앞 항목이 실패해도 나머지를 계속 판정한다
test.describe.configure({ mode: 'default' });

test.beforeAll(() => {
  if (!baseUrl) throw new Error('SMOKE_URL(또는 PREVIEW_URL)이 필요합니다');
  // 오타가 일반 모드로 조용히 떨어지지 않게 값을 제한한다
  if (!['', 'true', 'false'].includes(maintenance)) {
    throw new Error('SMOKE_MAINTENANCE 는 true 또는 false 여야 합니다');
  }
});

const ctx = smokeContext({
  baseUrl: baseUrl ?? 'http://invalid.localhost',
  ...(process.env.SMOKE_EXPECT_RELEASE ? { expectRelease: process.env.SMOKE_EXPECT_RELEASE } : {}),
  ...(process.env.SMOKE_BYPASS_SECRET ? { bypassSecret: process.env.SMOKE_BYPASS_SECRET } : {}),
  ...(process.env.SMOKE_BYPASS_HOST_PATTERN
    ? { bypassHostPattern: process.env.SMOKE_BYPASS_HOST_PATTERN }
    : {}),
  maintenance: maintenance === 'true',
});

for (const check of SMOKE_CHECKS) {
  test(check.title, async () => {
    const result = await runSmokeCheck(check, ctx);
    expect(result.problems, check.title).toEqual([]);
  });
}
