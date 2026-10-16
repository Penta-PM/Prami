/**
 * 세션을 **연장하지 않는** 경로 (#31 PR-3, Plan msg_11c3d58840d1). Auth.js 래퍼(proxy)는 응답마다 새로 서명한 세션 쿠키
 * (JWT, maxAge 8h)를 붙여 유휴 만료를 밀어낸다. 알림 폴링(보이는 탭 60초마다)이 이를 받으면 띄워 둔 탭만으로 세션이
 * 무기한 연장되므로, 이 경로 응답에서는 세션 토큰 Set-Cookie 를 떼어 낸다 — 세션 검증(만료면 401)은 그대로, 사용자 조작
 * (이동·Action)만 유휴 시간을 연장한다. 챗봇 상태 조회(/api/chat/status)는 슬라이딩 그대로(대상 아님).
 * 순수 함수 — proxy.ts 가 쓰고 단위 테스트가 직접 검사한다.
 */
export const NO_SESSION_REFRESH_PATHS = ['/api/notifications'] as const;

/** authjs.session-token / __Secure-authjs.session-token, 큰 토큰의 조각(.0 .1 …) 포함 */
const SESSION_COOKIE = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?=/;

export function withoutSessionRefresh(pathname: string, response: Response): Response {
  if (!(NO_SESSION_REFRESH_PATHS as readonly string[]).includes(pathname)) return response;
  const cookies = response.headers.getSetCookie();
  if (!cookies.some((cookie) => SESSION_COOKIE.test(cookie))) return response;
  response.headers.delete('set-cookie');
  for (const cookie of cookies) {
    if (!SESSION_COOKIE.test(cookie)) response.headers.append('set-cookie', cookie);
  }
  return response;
}
