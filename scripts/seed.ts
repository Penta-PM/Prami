/**
 * `pnpm seed` — 픽스처 ADMIN·USER, 공지 샘플, 감사 로그 user.seed 를 기록한다 (AC-02).
 * 마이그레이션이 먼저 적용되어 있어야 한다 (`pnpm db:migrate`).
 */
import { loadEnvConfig } from '@next/env';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { createDb } = await import('../src/db');
  const { seedDatabase } = await import('../src/db/seed');

  const handle = await createDb();
  try {
    console.log(`[seed] driver=${handle.driver}`);
    const result = await seedDatabase(handle);
    for (const user of result.users)
      console.log(`[seed] user ${user.role.padEnd(5)} ${user.email}`);
    console.log(
      `[seed] notices=${result.noticeCount} audit_logs(user.seed)=${result.auditLogCount}`,
    );
    console.log('[seed] 완료');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
