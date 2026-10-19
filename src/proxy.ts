import { NextResponse, type NextRequest } from 'next/server';

import { canAccessAdminArea } from '@/lib/constants/permissions';
import { env, proxyTrustMode } from '@/env';
import { auth } from '@/server/auth/auth';
import { logger } from '@/server/log';
import { ipScopeFor, rateLimitedResponse, rateLimiters, rateLimitIpKey } from '@/server/rate-limit';
import { isForbiddenForwardedHost } from '@/server/security/forwarded-host';
import { withoutSessionRefresh } from '@/server/security/session-refresh';
import {
  buildCsp,
  createNonce,
  REQUEST_ID_HEADER,
  resolveRequestId,
} from '@/server/security/headers';

/**
 * 1차 방어 (§4.6) + 보안 헤더 (§4.8, AC-91). Next 16 에서 middleware 는 proxy 로 이름이 바뀌었다 (Node 런타임).
 * - 모든 문서·API 응답: 요청별 CSP nonce(Next 가 자기 인라인 스크립트에 붙인다) + x-request-id
 * - 공개 경로(/login, /share/*, /api/auth/*): 인증 없이 통과 — CSP 는 동일하게 적용 (공유 페이지 포함, PR-8 QA INFO-4)
 * - 비로그인: 페이지는 /login 으로, API 는 401 봉투
 * - /admin/* 에 ADMIN 이 아닌 역할: 감사 로그(denied) 후 / 로 이동
 * 권한의 최종 판단은 각 페이지·Action·Route 의 requirePermission (2차 방어)이 한다.
 * 정적 헤더(HSTS·X-Frame-Options 등)는 정적 자원까지 덮도록 next.config.ts headers() 가 붙인다.
 */
const PUBLIC_PREFIXES = ['/login', '/share/', '/api/auth/', '/api/health'] as const;

const matchesPrefix = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) =>
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix,
  );

/** `/api/health` 는 정확히 그 경로만 공개 — `/api/health/deep` 은 ADMIN 세션 필요 (PRAMI-003 §4.3.10) */
export function isPublicPath(pathname: string): boolean {
  return matchesPrefix(pathname, PUBLIC_PREFIXES);
}

/** 점검 모드에서도 열어 두는 경로: ADMIN 로그인과 헬스 (런북 R-3, Q-13) */
const MAINTENANCE_OPEN_PREFIXES = ['/login', '/api/auth/', '/api/health'] as const;

export function isOpenDuringMaintenance(pathname: string): boolean {
  return matchesPrefix(pathname, MAINTENANCE_OPEN_PREFIXES);
}

export const MAINTENANCE_MESSAGE = '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.';

/** 점검 모드 503 — API 는 봉투, 페이지는 짧은 안내 문서 */
function maintenanceResponse(pathname: string, context: SecurityContext): NextResponse {
  const headers = { 'Retry-After': '300', 'cache-control': 'no-store' };
  if (pathname.startsWith('/api/')) {
    return decorate(
      NextResponse.json(
        { ok: false, error: { code: 'MAINTENANCE', message: MAINTENANCE_MESSAGE } },
        { status: 503, headers },
      ),
      context,
    );
  }
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>점검 중 — Prami</title><p>${MAINTENANCE_MESSAGE}</p></html>`;
  return decorate(
    new NextResponse(html, {
      status: 503,
      headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
    }),
    context,
  );
}

type SecurityContext = { csp: string; nonce: string; requestId: string };

function securityContext(request: NextRequest): SecurityContext {
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    isHttps: (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https://'),
  });
  return { csp, nonce, requestId: resolveRequestId(request.headers.get(REQUEST_ID_HEADER)) };
}

/** 요청 헤더에 nonce·CSP·요청 ID 를 실어 다음 단계(페이지·Route)로 넘기고 응답에도 붙인다 */
function passThrough(request: NextRequest, context: SecurityContext): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', context.nonce);
  requestHeaders.set('Content-Security-Policy', context.csp);
  requestHeaders.set(REQUEST_ID_HEADER, context.requestId);
  return decorate(NextResponse.next({ request: { headers: requestHeaders } }), context);
}

function decorate(response: NextResponse, context: SecurityContext): NextResponse {
  response.headers.set('Content-Security-Policy', context.csp);
  response.headers.set(REQUEST_ID_HEADER, context.requestId);
  return response;
}

/** 공유 페이지·PDF·auth 콜백은 IP 기준 분당 상한 (§4.8 r6, AC-95). 초과면 429 응답, 아니면 null */
async function limitByIp(
  request: NextRequest,
  context: SecurityContext,
): Promise<NextResponse | null> {
  const scope = ipScopeFor(request.nextUrl.pathname, request.method);
  if (!scope) return null;
  // 저장소에는 원문 IP 대신 HMAC 키 (PRAMI-003 §4.3.7)
  const decision = await rateLimiters[scope].hit(
    rateLimitIpKey(request.headers, proxyTrustMode(env)),
  );
  if (decision.allowed) return null;
  logger.warn('rate_limited', { scope, requestId: context.requestId });
  const limited = rateLimitedResponse(decision);
  return decorate(new NextResponse(limited.body, limited), context);
}

const authProxy = auth(async (request) => {
  const context = securityContext(request);
  const { pathname, search } = request.nextUrl;
  // preview 위조 X-Forwarded-Host 차단 (PR #25 QA L-3 — 로그인 state 에 공격자 origin 이 봉인되지 않게)
  if (
    isForbiddenForwardedHost(request.headers.get('x-forwarded-host'), request.headers.get('host'))
  ) {
    logger.warn('proxy.forwarded_host_rejected', { requestId: context.requestId });
    return decorate(
      NextResponse.json(
        { ok: false, error: { code: 'VALIDATION', message: '허용되지 않은 호스트입니다' } },
        { status: 400 },
      ),
      context,
    );
  }
  const limited = await limitByIp(request, context);
  if (limited) return limited;
  const user = request.auth?.user;
  // 점검 모드 (런북 R-3): 비 ADMIN 의 쓰기·조회를 막고 ADMIN 은 복구 작업을 위해 통과
  if (env.MAINTENANCE_MODE && !isOpenDuringMaintenance(pathname) && user?.role !== 'ADMIN') {
    return maintenanceResponse(pathname, context);
  }
  if (isPublicPath(pathname)) return passThrough(request, context);

  if (!user?.id) {
    if (pathname.startsWith('/api/')) {
      return decorate(
        NextResponse.json(
          { ok: false, error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다' } },
          { status: 401 },
        ),
        context,
      );
    }
    const loginUrl = new URL('/login', request.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', `${pathname}${search}`);
    return decorate(NextResponse.redirect(loginUrl), context);
  }

  if (pathname.startsWith('/admin') && !canAccessAdminArea(user.role)) {
    await recordAdminDenied(user.id, user.email ?? user.id, user.role, pathname, request.headers);
    return decorate(NextResponse.redirect(new URL('/', request.nextUrl.origin)), context);
  }

  return passThrough(request, context);
});

async function recordAdminDenied(
  userId: string,
  label: string,
  role: string,
  pathname: string,
  headers: Headers,
): Promise<void> {
  // IP 산출은 audit/log.ts 의 단일 함수가 한다 (§4.8 r3) — proxy 는 헤더를 넘기기만 한다
  const [{ getDb }, { AUDIT_ACTIONS, requestMetaFromHeaders, writeAudit }] = await Promise.all([
    import('@/db'),
    import('@/server/audit/log'),
  ]);
  try {
    await writeAudit(await getDb(), {
      actor: { id: userId, label },
      action: AUDIT_ACTIONS.accessDenied,
      target: { type: 'route', id: pathname, label: pathname },
      after: { permission: 'admin-area', role },
      result: 'denied',
      meta: requestMetaFromHeaders(headers, proxyTrustMode(env)),
    });
  } catch (error) {
    // 감사 기록 실패가 차단 자체를 막지 않도록 한다 (리다이렉트는 그대로 수행)
    logger.error('proxy.audit_failed', { pathname, error });
  }
}

export default async function proxy(...args: Parameters<typeof authProxy>) {
  const response = await authProxy(...args);
  return response ? withoutSessionRefresh(args[0].nextUrl.pathname, response) : response;
}

export const config = {
  // 정적 자원·이미지 최적화·파비콘은 제외 (문서·API 는 전부 CSP 대상). 로그인·공유는 isPublicPath 로 인증만 건너뛴다
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|webp|ttf|woff2?)$).*)',
  ],
};
