/**
 * 배포 식별자 (PRAMI-003 §4.3.8). 헬스 응답과 모든 구조화 로그에 싣는다.
 * release: `APP_RELEASE`(런타임) → 빌드 때 고정한 `APP_RELEASE`(next.config `env` 가 `process.env.APP_RELEASE_BUILD` 로 인라인 —
 *   Actions 는 `vercel build` 단계에만 APP_RELEASE 를 주므로 런타임 env 에는 없다, PR-4 리뷰 H1) → `VERCEL_GIT_COMMIT_SHA`(Vercel preview) → `dev`
 * env: `VERCEL_ENV` 또는 `local`
 * log.ts 가 env.ts 를 import 하지 않도록(순환 방지) process.env 를 직접 읽는다.
 */
export type ReleaseInfo = { release: string; env: string };

/** 빌드 시 인라인되는 값 — 반드시 `process.env.APP_RELEASE_BUILD` 리터럴로 읽어야 Next 가 치환한다 */
const BUILD_RELEASE: string | undefined = process.env.APP_RELEASE_BUILD;

export function releaseInfo(
  source: Record<string, string | undefined> = process.env,
  buildRelease: string | undefined = BUILD_RELEASE,
): ReleaseInfo {
  const pick = (value: string | undefined) => (value && value.trim() !== '' ? value.trim() : null);
  return {
    release:
      pick(source.APP_RELEASE) ?? pick(buildRelease) ?? pick(source.VERCEL_GIT_COMMIT_SHA) ?? 'dev',
    env: pick(source.VERCEL_ENV) ?? 'local',
  };
}
