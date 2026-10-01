import { execSync } from 'node:child_process';

import { E2E_ENV } from '../../playwright.config';

/**
 * E2E 대상 DB 에 마이그레이션·시드를 적용하고, 조회 화면용으로 원본 200행 픽스처를 적용해 둔다
 * (픽스처 ADMIN·USER — AC-02, 가격정책 데이터 — QA-04, 품목 마스터 — PRAMI-003). 이미 적용된 파일은 재사용된다.
 */
export default function globalSetup(): void {
  const env = { ...process.env, ...E2E_ENV };
  execSync('pnpm db:migrate', { stdio: 'inherit', env });
  execSync('pnpm seed', { stdio: 'inherit', env });
  execSync('pnpm import:source tests/fixtures/imports/sales-200.xlsx', { stdio: 'inherit', env });
  // 품목 마스터(합성, 실데이터 분류) — 종류는 마스터 적용 시 저장된 값만 쓰므로(PRAMI-003 §4.2.7) 계산기·파츠 화면에 필요
  execSync('pnpm import:source tests/fixtures/imports/items-v1.xlsx --kind items', {
    stdio: 'inherit',
    env,
  });
  execSync('pnpm import:source tests/fixtures/imports/costs-dup.xlsx --kind costs', {
    stdio: 'inherit',
    env,
  });
}
