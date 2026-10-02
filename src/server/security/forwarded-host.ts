import { deployTarget } from '@/env-deploy';

/**
 * preview X-Forwarded-Host 심층 방어 (PRAMI-003 PR #25 QA L-3).
 * preview 는 AUTH_URL 이 없어 Auth.js 가 `trustHost` 로 요청 Host·X-Forwarded-Host 를 origin 으로 쓴다. 클라이언트가 보낸
 * X-Forwarded-Host 가 앱까지 그대로 오는 호스팅이면, 서버 액션 `signIn()` 이 공격자 origin 을 state 에 봉인해 고정 호스트가
 * 피해자의 Google code 를 공격자에게 302 할 수 있다. Vercel 엣지는 이 헤더를 직접 설정하지만(PR-5 C-11a 에서 실측) 앱이 따로 막는다:
 * preview 에서 X-Forwarded-Host 가 있으면 아래 허용 목록 중 하나여야 한다. production 은 AUTH_URL 고정이라 적용하지 않는다.
 * - 요청 Host 와 같은 값 (Vercel 은 둘을 같게 둔다)
 * - Vercel 이 런타임에 주입하는 이 배포의 호스트 `VERCEL_URL`·`VERCEL_BRANCH_URL`
 * - 고정 preview 호스트 `NEXT_PUBLIC_APP_URL` 의 host
 */
type Source = Record<string, string | undefined>;

const normalizeHost = (value: string) => value.trim().toLowerCase().replace(/\.$/, '');

function hostOfUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeHost(new URL(value).host);
  } catch {
    return null;
  }
}

export function allowedForwardedHosts(host: string | null, source: Source): Set<string> {
  const candidates = [
    host,
    source.VERCEL_URL,
    source.VERCEL_BRANCH_URL,
    hostOfUrl(source.NEXT_PUBLIC_APP_URL),
  ];
  return new Set(
    candidates.filter((value): value is string => Boolean(value?.trim())).map(normalizeHost),
  );
}

/** 막아야 하는 X-Forwarded-Host 인지. preview 가 아니거나 헤더가 없으면 false */
export function isForbiddenForwardedHost(
  forwardedHost: string | null,
  host: string | null,
  source: Source = process.env,
): boolean {
  if (forwardedHost === null || deployTarget(source) !== 'preview') return false;
  // 여러 값(쉼표)은 프록시 체인 — 첫 값(Auth.js·Next 가 쓰는 값)을 포함해 전부 허용 목록이어야 한다
  const values = forwardedHost.split(',').map(normalizeHost);
  const allowed = allowedForwardedHosts(host, source);
  return values.some((value) => value === '' || !allowed.has(value));
}
