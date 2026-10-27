import 'server-only';

import { hasPermission } from '@/lib/constants/permissions';
import {
  getSessionUser,
  requirePagePermission,
  requirePermission,
  runRoute,
} from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';

import {
  AUDIT_PROCUREMENT_READ,
  AUDIT_PROCUREMENT_WRITE,
  grantProcurementAccess,
  type ProcurementAccess,
  type ProcurementScope,
} from './access-token';

export {
  AUDIT_PROCUREMENT_READ,
  AUDIT_PROCUREMENT_WRITE,
  assertProcurementAccess,
  procurementAccessForTests,
} from './access-token';
export type { ProcurementAccess, ProcurementScope } from './access-token';

/**
 * Action/Route 용. 비로그인 → AppError(UNAUTHENTICATED), 권한 없음 → AppError(FORBIDDEN) +
 * 감사 `procurement.read`/`procurement.write` denied (§4.7.1, 원가 requireCostAccess 와 같은 규칙).
 */
export async function requireProcurementAccess(
  scope: ProcurementScope,
  target: string,
): Promise<ProcurementAccess> {
  const user = await requirePermission({
    permission: scope === 'read' ? 'procurement.read' : 'procurement.write',
    auditAction: scope === 'read' ? AUDIT_PROCUREMENT_READ : AUDIT_PROCUREMENT_WRITE,
    target,
  });
  return grantProcurementAccess(user, scope);
}

/**
 * 페이지용 (2차 방어): 비로그인 → /login, 권한 없음 → 감사 denied 후 /.
 * 조회 화면(/procurement/*) = read, 관리 화면(/admin/procurement) = write.
 */
export async function requireProcurementPageAccess(
  path: string,
  scope: ProcurementScope = 'read',
): Promise<ProcurementAccess> {
  return (await requireProcurementPage(path, scope)).access;
}

/**
 * requireProcurementPageAccess 와 같은 가드 + 세션 사용자 (조달이 통합 UI-1). 화면 RSC 가 조회 상태 복원(restoreViewState —
 * 세션 사용자의 id·role 필요)을 함께 할 때 쓴다 — 세션을 두 번 읽지 않게.
 */
export async function requireProcurementPage(
  path: string,
  scope: ProcurementScope = 'read',
): Promise<{ user: SessionUser; access: ProcurementAccess }> {
  const user = await requirePagePermission(
    scope === 'read' ? 'procurement.read' : 'procurement.write',
    path,
  );
  return { user, access: grantProcurementAccess(user, scope) };
}

/**
 * Route Handler 용 (조달이 통합 UI-2 — xlsx 내려받기 등). runRoute 와 같은 봉투·감사 규칙: 비로그인 401, 권한 없음 403 +
 * 감사 `procurement.read`/`procurement.write` denied. 통과하면 같은 세션 사용자로 토큰을 만들어 넘긴다.
 */
export async function runProcurementRoute(
  scope: ProcurementScope,
  target: string,
  fn: (access: ProcurementAccess) => Promise<Response>,
): Promise<Response> {
  const guard = {
    permission: scope === 'read' ? 'procurement.read' : 'procurement.write',
    auditAction: scope === 'read' ? AUDIT_PROCUREMENT_READ : AUDIT_PROCUREMENT_WRITE,
    target,
  } as const;
  return runRoute(guard, async (user) => fn(grantProcurementAccess(user, scope)));
}

/**
 * 조회 상태 정규화용 (page-state-memory §2.7-1, 원가 optionalCostReadAccess 와 같은 규칙): 세션 사용자에게 procurement.read 가
 * 있으면 read 토큰, 없으면 null(감사 기록 없음 — 거부가 아니라 "복원하지 않음").
 */
export async function optionalProcurementReadAccess(): Promise<ProcurementAccess | null> {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, 'procurement.read')) return null;
  return grantProcurementAccess(user, 'read');
}
