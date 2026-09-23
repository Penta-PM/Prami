import { execSync } from 'node:child_process';

import { E2E_ENV } from '../../playwright.config';

/** E2E 대상 DB 에 마이그레이션·시드를 적용한다 (픽스처 ADMIN·USER — AC-02) */
export default function globalSetup(): void {
  const env = { ...process.env, ...E2E_ENV };
  execSync('pnpm db:migrate', { stdio: 'inherit', env });
  execSync('pnpm seed', { stdio: 'inherit', env });
}
