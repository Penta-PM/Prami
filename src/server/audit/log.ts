import type { Db } from '@/db';
import { auditLogs, type NewAuditLog } from '@/db/schema';
import type { Tx } from '@/db/tx';
import type { ProxyTrustMode } from '@/env';

/** 감사 로그를 쓸 수 있는 실행자: 공유 DB 또는 진행 중인 트랜잭션 (변경과 같은 배치로 기록 — §4.2 원칙 4) */
export type AuditExecutor = Db | Tx;

/** 요청 출처 정보 (IP·User-Agent). 요청 밖(스크립트·테스트)에서는 비어 있다 */
export type RequestMeta = { ip: string | null; userAgent: string | null };

export const EMPTY_REQUEST_META: RequestMeta = { ip: null, userAgent: null };

/** 감사 행위 이름 (§4.6.1 + 사용자 관리). 새 행위는 여기에 추가한다 */
export const AUDIT_ACTIONS = {
  login: 'auth.login',
  deniedDomain: 'auth.denied_domain',
  deniedInactive: 'auth.denied_inactive',
  deniedUnregistered: 'auth.denied_unregistered',
  accessDenied: 'auth.access_denied',
  autoProvisioned: 'user.auto_provisioned',
  bootstrapAdmin: 'user.bootstrap_admin',
  userCreate: 'user.create',
  userUpdate: 'user.update',
  userDeactivate: 'user.deactivate',
  userSeed: 'user.seed',
  deniedTestMode: 'auth.denied_test_mode',
  // PRAMI-002 §4.11 — 값(키·힌트·암호문)은 기록하지 않는다
  llmCredentialCreate: 'settings.llm_credential.create',
  llmCredentialReplace: 'settings.llm_credential.replace',
  llmCredentialDelete: 'settings.llm_credential.delete',
  llmCredentialVerify: 'settings.llm_credential.verify',
  llmDefaultUpdate: 'settings.llm_default.update',
  kekRewrap: 'system.kek_rewrap',
} as const;

export type AuditActor = { id: string | null; label: string };

export type AuditEntry = {
  actor: AuditActor;
  action: string;
  target?: { type: string; id?: string | null; label?: string | null };
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  result?: NewAuditLog['result'];
  meta?: RequestMeta;
};

/** 단일 IP 문자열 정규화 (포트 제거). inet 으로 저장할 수 없는 값은 버린다 */
export function normalizeIp(raw: string | null | undefined): string | null {
  const first = raw?.trim();
  if (!first) return null;
  const withoutPort = /^[\d.]+:\d+$/.test(first) ? first.slice(0, first.lastIndexOf(':')) : first;
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-f:.]+$/i;
  return ipv4.test(withoutPort) || (withoutPort.includes(':') && ipv6.test(withoutPort))
    ? withoutPort
    : null;
}

/**
 * 감사 로그 IP·User-Agent 산출 — 이 함수 한 곳에서만 한다 (§4.8 r3). Action/Route/proxy 는 헤더를 직접 해석하지 않는다.
 * - 신뢰 프록시 설정(TRUST_PROXY_HEADERS, 기본 비신뢰)이 꺼져 있으면 클라이언트가 위조할 수 있는
 *   x-forwarded-for / x-real-ip 를 쓰지 않고 IP 는 NULL.
 * - 켜져 있으면 x-real-ip, 없으면 x-forwarded-for 의 **오른쪽 끝**(신뢰 프록시가 덧붙인 값)을 쓴다.
 *   왼쪽 값은 클라이언트가 넣을 수 있으므로 쓰지 않는다. Vercel 운영 헤더 확정은 PR-11(AC-93).
 */
export function requestMetaFromHeaders(
  source: Headers,
  trust: ProxyTrustMode | boolean,
): RequestMeta {
  const userAgent = source.get('user-agent');
  const mode: ProxyTrustMode = trust === true ? 'generic' : trust === false ? 'none' : trust;
  return { ip: normalizeIp(trustedClientIp(source, mode)), userAgent };
}

/**
 * 신뢰 모드별 클라이언트 IP 후보 (AC-93 로컬 구조).
 * - vercel: Vercel 엣지가 클라이언트 값을 덮어쓰는 x-vercel-forwarded-for(첫 값) → x-real-ip. x-forwarded-for 는 쓰지 않는다
 * - generic: x-real-ip → x-forwarded-for 오른쪽 끝
 * - none: 없음
 */
export function trustedClientIp(source: Headers, mode: ProxyTrustMode): string | null {
  if (mode === 'none') return null;
  if (mode === 'vercel') {
    const vercel = source.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
    return vercel || source.get('x-real-ip')?.trim() || null;
  }
  const forwarded = source
    .get('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return source.get('x-real-ip')?.trim() || forwarded?.at(-1) || null;
}

export function toAuditRow(entry: AuditEntry): NewAuditLog {
  const meta = entry.meta ?? EMPTY_REQUEST_META;
  return {
    actorUserId: entry.actor.id,
    actorLabel: entry.actor.label,
    action: entry.action,
    targetType: entry.target?.type ?? null,
    targetId: entry.target?.id ?? null,
    targetLabel: entry.target?.label ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    ip: normalizeIp(meta.ip),
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
    result: entry.result ?? 'success',
  };
}

/** 감사 로그 1건 기록 (append-only) */
export async function writeAudit(executor: AuditExecutor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLogs).values(toAuditRow(entry));
}
