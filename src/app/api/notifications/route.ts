import { getDb } from '@/db';
import type { NotificationsResponse } from '@/features/notifications/types';
import { runRoute } from '@/server/auth/rbac';
import { clampLimit, getNotifications } from '@/server/notifications/queries';

/**
 * GET /api/notifications?limit=1..50 (#31 §4, notification.self): 본인 알림 최근 30일·최신순 + 안 읽은 개수.
 * 폴링 대상이라 캐시하지 않는다. 조회는 감사 로그에 남기지 않는다(거부만 runRoute 가 남긴다).
 */
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const guard = {
    permission: 'notification.self',
    auditAction: 'notification.list',
    target: '/api/notifications',
  } as const;
  return runRoute(guard, async (user) => {
    const limit = clampLimit(new URL(request.url).searchParams.get('limit'));
    const data: NotificationsResponse = await getNotifications(await getDb(), user.id, { limit });
    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  });
}
