import { NOTIFICATION_TYPES, type NotificationType } from '@/features/notifications/types';
import { hasFinalConsonant } from '@/lib/korean';
import { ROLE_LABELS, type PermissionKey, type Role } from '@/lib/constants/permissions';

export { NOTIFICATION_TYPES, type NotificationType };

/**
 * 민감정보 규칙 (#31 §2): type 마다 그 알림을 받아도 되는 권한. 수신 대상은 이 권한을 가진 역할만이어야 한다.
 * 원가 계열(cost.*) 권한을 요구하는 type 은 USER 에게 가면 안 되므로, type 을 추가할 때 이 표와 단위 테스트를 함께 고친다.
 */
export const NOTIFICATION_REQUIRED_PERMISSION: Record<NotificationType, PermissionKey> = {
  'notice.created': 'notice.read',
  'policy.applied': 'pricing.read',
  'user.role_changed': 'notification.self',
};

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/** 알림 참조 대상 종류 (ref_type) */
export const NOTIFICATION_REF = {
  notice: 'notice',
  policyApplyRun: 'policy_apply_run',
  user: 'user',
} as const;

export const NOTIFICATION_TITLE_MAX = 200;
export const NOTIFICATION_BODY_MAX = 500;

/** DB check(≤200/≤500)를 넘지 않도록 자른다 */
export function clampText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

export type NotificationContent = { title: string; body: string | null };

/**
 * 제목·본문 빌더. 금액·원가는 넣지 않는다(§2 민감정보 규칙) — 입력도 금액을 받지 않는 모양으로 제한한다.
 */
export const notificationContent = {
  noticeCreated(noticeTitle: string): NotificationContent {
    return { title: clampText(`새 공지: ${noticeTitle}`, NOTIFICATION_TITLE_MAX), body: null };
  },
  policyApplied(appliedRows: number): NotificationContent {
    const count = Number.isFinite(appliedRows) ? Math.max(0, Math.trunc(appliedRows)) : 0;
    return { title: '가격정책이 갱신되었습니다', body: `반영 ${count}건` };
  },
  roleChanged(role: Role): NotificationContent {
    const label = ROLE_LABELS[role];
    return {
      title: `역할이 ${label}${hasFinalConsonant(label) ? '으로' : '로'} 변경되었습니다`,
      body: null,
    };
  },
};
