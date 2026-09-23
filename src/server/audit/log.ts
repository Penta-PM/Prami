import type { Db } from '@/db';
import { auditLogs, type NewAuditLog } from '@/db/schema';
import type { Tx } from '@/db/tx';

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

/** 쉼표로 이어진 x-forwarded-for 에서 첫 IP 만 취하고, inet 으로 저장할 수 없는 값은 버린다 */
export function normalizeIp(raw: string | null | undefined): string | null {
  const first = raw?.split(',')[0]?.trim();
  if (!first) return null;
  const withoutPort = /^[\d.]+:\d+$/.test(first) ? first.slice(0, first.lastIndexOf(':')) : first;
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-f:.]+$/i;
  return ipv4.test(withoutPort) || (withoutPort.includes(':') && ipv6.test(withoutPort))
    ? withoutPort
    : null;
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
