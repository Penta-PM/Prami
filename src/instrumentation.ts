/**
 * 서버 기동 훅 (Node 런타임에서만, 실패해도 기동은 계속):
 * - 관리자 부트스트랩 설정 점검
 * - 스키마 버전 검사·운영 fixture 계정 검사 (PRAMI-003 §4.3.6·§4.9.3 L4) — 결과는 로그, 헬스가 503 으로 노출
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const [{ getDb }, { env }, { warnIfNoAdmin }, { runStartupChecks }] = await Promise.all([
      import('@/db'),
      import('@/env'),
      import('@/server/auth/bootstrap-check'),
      import('@/server/ops/startup-checks'),
    ]);
    const db = await getDb();
    await warnIfNoAdmin(db, env.ADMIN_EMAILS);
    await runStartupChecks(db);
  } catch (error) {
    console.warn(
      '[startup] 기동 점검을 건너뜁니다:',
      error instanceof Error ? error.message : error,
    );
  }
}
