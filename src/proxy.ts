import { NextResponse } from 'next/server';

import { canAccessAdminArea } from '@/lib/constants/permissions';
import { auth } from '@/server/auth/auth';

/**
 * 1차 방어 (§4.6). Next 16 에서 middleware 는 proxy 로 이름이 바뀌었다 (Node 런타임).
 * - 비로그인: 페이지는 /login 으로, API 는 401 봉투로 응답
 * - /admin/* 에 ADMIN 이 아닌 역할: 감사 로그(denied) 후 / 로 이동
 * 권한의 최종 판단은 각 페이지·Action·Route 의 requirePermission (2차 방어)이 한다.
 * 전체 auth 설정을 쓰므로 jwt 콜백이 DB 로 역할·활성 여부를 갱신하고 쿠키도 새 토큰으로 바뀐다.
 */
export default auth(async (request) => {
  const { pathname, search } = request.nextUrl;
  const user = request.auth?.user;

  if (!user?.id) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다' } },
        { status: 401 },
      );
    }
    const loginUrl = new URL('/login', request.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/admin') && !canAccessAdminArea(user.role)) {
    await recordAdminDenied(user.id, user.email ?? user.id, user.role, pathname, request.headers);
    return NextResponse.redirect(new URL('/', request.nextUrl.origin));
  }

  return NextResponse.next();
});

async function recordAdminDenied(
  userId: string,
  label: string,
  role: string,
  pathname: string,
  headers: Headers,
): Promise<void> {
  // IP 산출은 audit/log.ts 의 단일 함수가 한다 (§4.8 r3) — proxy 는 헤더를 넘기기만 한다
  const [
    { getDb },
    { AUDIT_ACTIONS, requestMetaFromHeaders, writeAudit },
    { env, trustsProxyHeaders },
  ] = await Promise.all([import('@/db'), import('@/server/audit/log'), import('@/env')]);
  try {
    await writeAudit(await getDb(), {
      actor: { id: userId, label },
      action: AUDIT_ACTIONS.accessDenied,
      target: { type: 'route', id: pathname, label: pathname },
      after: { permission: 'admin-area', role },
      result: 'denied',
      meta: requestMetaFromHeaders(headers, trustsProxyHeaders(env)),
    });
  } catch (error) {
    // 감사 기록 실패가 차단 자체를 막지 않도록 한다 (리다이렉트는 그대로 수행)
    console.error('[proxy] 접근 거부 감사 기록 실패', error);
  }
}

export const config = {
  // 로그인·Auth.js 엔드포인트·정적 자원·견적 공유 페이지(/share/*, 토큰이 접근 권한 — §4.5.8)는 제외
  matcher: [
    '/((?!login|share/|api/auth|_next/static|_next/image|favicon.ico|.*\.(?:png|svg|ico|jpg|webp)$).*)',
  ],
};
