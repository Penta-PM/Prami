import 'server-only';

import { hasPermission } from '@/lib/constants/permissions';
import { getSessionUser, requirePagePermission, requirePermission } from '@/server/auth/rbac';

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

/**
 * 원가 열을 **곁들여** 보여 주는 화면용(가격정책 관리의 원가 비중, 스펙 cost-ratio-price-change §2.3): 세션 사용자가 cost.read 를
 * 가졌으면 read 토큰, 아니면 null. 거부가 아니라 "열 없음"이므로 감사 denied 를 남기지 않는다(/admin/costs 페이지 조회와 같은
 * 단위 — 성공 조회는 행마다 기록하지 않는다).
 */
export async function optionalCostReadAccess(): Promise<CostAccess | null> {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, 'cost.read')) return null;
  return grantCostAccess(user, 'read');
}
