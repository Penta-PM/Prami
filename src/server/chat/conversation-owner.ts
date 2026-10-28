import 'server-only';

import { hasPermission } from '@/lib/constants/permissions';
import { recordAccessDenied } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';

import type { ChatOwner } from './conversations';

/** 세션 사용자 → 대화 소유자. domain 권한 거부는 rbac 와 같은 감사 denied(action = 시도한 행위 키)를 남긴다 */
export function chatOwner(user: SessionUser, target: string, auditAction: string): ChatOwner {
  return {
    userId: user.id,
    label: user.email,
    can: (key) => hasPermission(user.role, key),
    denied: (key) => recordAccessDenied(user, key, target, auditAction),
  };
}
