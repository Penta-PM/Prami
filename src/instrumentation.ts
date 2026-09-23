/** 서버 기동 훅: 관리자 부트스트랩 설정 점검 (Node 런타임에서만, 실패해도 기동은 계속) */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const [{ getDb }, { env }, { warnIfNoAdmin }] = await Promise.all([
      import('@/db'),
      import('@/env'),
      import('@/server/auth/bootstrap-check'),
    ]);
    await warnIfNoAdmin(await getDb(), env.ADMIN_EMAILS);
  } catch (error) {
    console.warn(
      '[auth] 관리자 부트스트랩 점검을 건너뜁니다:',
      error instanceof Error ? error.message : error,
    );
  }
}
