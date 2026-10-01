/**
 * 배포 식별자 (PRAMI-003 §4.3.8). 헬스 응답과 모든 구조화 로그에 싣는다.
 * release: `APP_RELEASE`(Actions 주입) → `VERCEL_GIT_COMMIT_SHA`(Vercel preview) → `dev`
 * env: `VERCEL_ENV` 또는 `local`
 * log.ts 가 env.ts 를 import 하지 않도록(순환 방지) process.env 를 직접 읽는다.
 */
export type ReleaseInfo = { release: string; env: string };

export function releaseInfo(source: Record<string, string | undefined> = process.env): ReleaseInfo {
  const pick = (value: string | undefined) => (value && value.trim() !== '' ? value.trim() : null);
  return {
    release: pick(source.APP_RELEASE) ?? pick(source.VERCEL_GIT_COMMIT_SHA) ?? 'dev',
    env: pick(source.VERCEL_ENV) ?? 'local',
  };
}
