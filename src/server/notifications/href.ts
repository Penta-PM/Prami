import type { NotificationType } from '@/features/notifications/types';

/**
 * 알림 이동 경로 (#31 §4). link 컬럼 없이 서버가 type·refId 로 계산한다 — 결과는 내부 경로 3종뿐이다:
 * `/notices/{uuid}` · `/pricing` · `/settings`. refId 는 소문자 정규화한 UUID 일 때만 경로에 들어간다.
 * 공지 알림의 refId 가 UUID 가 아니면 null — 목록에서 그 행을 뺀다(허용 3종 밖의 경로를 만들지 않는다).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function notificationHref(
  type: NotificationType,
  refId: string | null | undefined,
): string | null {
  switch (type) {
    case 'notice.created':
      return isUuid(refId) ? `/notices/${refId.toLowerCase()}` : null;
    case 'policy.applied':
      return '/pricing';
    case 'user.role_changed':
      return '/settings';
    default:
      return null;
  }
}
