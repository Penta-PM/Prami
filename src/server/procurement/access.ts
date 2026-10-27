import 'server-only';

import { requirePagePermission, requirePermission } from '@/server/auth/rbac';
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
