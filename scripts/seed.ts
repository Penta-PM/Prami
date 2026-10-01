/**
 * `pnpm seed` — 픽스처 ADMIN·USER, 공지 샘플, 감사 로그 user.seed 를 기록한다 (AC-02).
 * 마이그레이션이 먼저 적용되어 있어야 한다 (`pnpm db:migrate`).
 * CI·E2E·격리 DB 전용: 원격 DB 에서는 거부하고, 로컬이어도 PRAMI_ALLOW_SEED=1 일 때만 실행한다 (PRAMI-003 §4.9.3 L2).
 * 운영·로컬 :3000 의 실데이터 적재는 seed 가 아니라 docs/deploy/local.md 의 클린 설치 절차를 쓴다.
 */
import { loadEnvConfig } from '@next/env';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { assertSeedTargetIsLocal } = await import('../src/db/seed');
  // DB 연결을 만들기 전에 판정한다 (연결 시도 자체가 없어야 한다 — AC-323)
  assertSeedTargetIsLocal(process.env);
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
