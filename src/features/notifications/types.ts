/**
 * 앱 내 알림 공용 타입 (#31). 클라이언트에서도 import 하므로 서버 모듈을 import 하지 않는다.
 */
export const NOTIFICATION_TYPES = [
  'notice.created',
  'policy.applied',
  'user.role_changed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationItemView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** 서버가 notificationHref 로 계산한 내부 경로: /notices/{uuid} | /pricing | /settings */
  href: string;
  /** ISO 8601 */
  createdAt: string;
  read: boolean;
  /** notice.created 이고 그 공지가 중요 공지면 true (중요 배지) */
  important: boolean;
};

export type NotificationsResponse = { unreadCount: number; items: NotificationItemView[] };

export const NOTIFICATIONS_API_PATH = '/api/notifications';
export const NOTIFICATION_LIST_LIMIT = 20;
