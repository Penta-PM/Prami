import { describe, expect, it } from 'vitest';

import { NO_SESSION_REFRESH_PATHS, withoutSessionRefresh } from '@/server/security/session-refresh';

/**
 * #31 PR-3 (Plan msg_11c3d58840d1): 알림 폴링 응답은 세션 쿠키를 재발급하지 않는다 — 띄워 둔 탭만으로 8시간 유휴 만료가
 * 밀리지 않게. 다른 경로(일반 이동·챗봇 상태 조회)는 그대로.
 */
const SESSION = 'authjs.session-token=eyJ.new; Path=/; HttpOnly; SameSite=Lax';
const SECURE = '__Secure-authjs.session-token=eyJ.new; Path=/; HttpOnly; Secure; SameSite=Lax';
const CHUNK = 'authjs.session-token.0=eyJ.part; Path=/; HttpOnly';
const OTHER = 'authjs.callback-url=%2F; Path=/; HttpOnly';

function response(...cookies: string[]) {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response('{}', { headers });
}

describe('withoutSessionRefresh', () => {
  it('대상 경로는 알림 API 하나', () => {
    expect(NO_SESSION_REFRESH_PATHS).toEqual(['/api/notifications']);
  });

  it('/api/notifications: 세션 토큰(일반·__Secure-·조각) Set-Cookie 만 떼고 나머지 쿠키·헤더는 유지', () => {
    const result = withoutSessionRefresh(
      '/api/notifications',
      response(SESSION, SECURE, CHUNK, OTHER),
    );
    expect(result.headers.getSetCookie()).toEqual([OTHER]);
    expect(result.headers.get('content-type')).toBe('application/json');
  });

  it('세션 쿠키가 없으면 응답을 그대로 둔다', () => {
    const original = response(OTHER);
    expect(withoutSessionRefresh('/api/notifications', original)).toBe(original);
    expect(original.headers.getSetCookie()).toEqual([OTHER]);
  });

  it.each(['/', '/api/chat/status', '/api/notifications/x', '/notices'])(
    '%s: 슬라이딩 연장 유지(세션 쿠키 그대로)',
    (pathname) => {
      const result = withoutSessionRefresh(pathname, response(SESSION, OTHER));
      expect(result.headers.getSetCookie()).toEqual([SESSION, OTHER]);
    },
  );
});
