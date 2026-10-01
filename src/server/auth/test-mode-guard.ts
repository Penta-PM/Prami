import 'server-only';

import type { Db } from '@/db';
import { AUDIT_ACTIONS, writeAudit, type RequestMeta } from '@/server/audit/log';
import type { RateLimiter } from '@/server/rate-limit';

/**
 * 테스트 Credentials 로그인 노출 차단 (§4.8 r5 ①, AC-94 ①).
 * AUTH_TEST_MODE 는 모든 픽스처 계정이 공용 비밀번호로 로그인되는 상태이므로, 요청 Host 가 허용 목록(기본 localhost·127.0.0.1)
 * 밖이면 비밀번호를 확인하기 전에 거부하고 감사 `auth.denied_test_mode` 를 남긴다. 세션은 발급되지 않는다.
 * Host 헤더는 클라이언트가 바꿀 수 있으므로 이 검사는 "실수로 LAN/공개 URL 에 열린 서버" 를 막는 2차 방어다 —
 * 1차 방어는 dev 서버 127.0.0.1 바인드(package.json)와 VERCEL_ENV 기동 거부(env.ts)다.
 */
export type TestLoginDecision = 'ok' | 'test_mode_host' | 'rate_limited';

/** Host 헤더 → 소문자 호스트명 (포트·IPv6 대괄호 제거) */
export function hostnameOf(host: string | null | undefined): string | null {
  const value = host?.trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(1, end) : null;
  }
  const colon = value.lastIndexOf(':');
  // 콜론이 하나뿐이면 host:port, 여럿이면 대괄호 없는 IPv6 전체
  return colon > 0 && value.indexOf(':') === colon ? value.slice(0, colon) : value;
}

export function isAllowedTestHost(host: string | null | undefined, allowed: readonly string[]) {
  const name = hostnameOf(host);
  if (!name) return false;
  return allowed.some((entry) => entry.trim().toLowerCase() === name);
}

export type TestLoginGuardInput = {
  db: Db;
  host: string | null;
  email: string;
  allowedHosts: readonly string[];
  limiter: RateLimiter;
  meta: RequestMeta;
};

export async function guardTestLogin(input: TestLoginGuardInput): Promise<TestLoginDecision> {
  if (!isAllowedTestHost(input.host, input.allowedHosts)) {
    await writeAudit(input.db, {
      actor: { id: null, label: input.email || '(이메일 없음)' },
      action: AUDIT_ACTIONS.deniedTestMode,
      target: { type: 'host', id: hostnameOf(input.host), label: input.host ?? '(Host 없음)' },
      reason: 'AUTH_TEST_ALLOWED_HOSTS 밖의 Host 에서 테스트 로그인 시도',
      result: 'denied',
      meta: input.meta,
    });
    return 'test_mode_host';
  }
  const key = input.email.trim().toLowerCase() || '(empty)';
  if (!(await input.limiter.hit(`login:${key}`)).allowed) return 'rate_limited';
  return 'ok';
}
