import 'server-only';

import { requirePagePermission, requirePermission } from '@/server/auth/rbac';

import {
  AUDIT_COST_READ,
  AUDIT_COST_WRITE,
  grantCostAccess,
  type CostAccess,
  type CostScope,
} from './access-token';

export {
  AUDIT_COST_READ,
  AUDIT_COST_WRITE,
  assertCostAccess,
  costAccessForTests,
} from './access-token';
export type { CostAccess, CostScope } from './access-token';

/** Action/Route 용. 거부 시 §4.7.1: AppError(FORBIDDEN) + 감사 `cost.read`/`cost.write` denied */
export async function requireCostAccess(scope: CostScope, target: string): Promise<CostAccess> {
  const user = await requirePermission({
    permission: scope === 'read' ? 'cost.read' : 'cost.write',
    auditAction: scope === 'read' ? AUDIT_COST_READ : AUDIT_COST_WRITE,
    target,
  });
  return grantCostAccess(user, scope);
}

/** 페이지용 (2차 방어): 비로그인 → /login, 권한 없음 → 감사 denied 후 / (§4.5.5 /admin/costs) */
export async function requireCostPageAccess(path: string): Promise<CostAccess> {
  const user = await requirePagePermission('cost.read', path);
  return grantCostAccess(user, 'read');
}
