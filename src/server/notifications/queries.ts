import 'server-only';

import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { notices, notifications } from '@/db/schema';
import type { Tx } from '@/db/tx';
import {
  NOTIFICATION_LIST_LIMIT,
  NOTIFICATION_TYPES,
  type NotificationItemView,
  type NotificationsResponse,
} from '@/features/notifications/types';

import { notificationHref } from './href';
import { isNotificationType, NOTIFICATION_REF } from './types';

/**
 * 본인 알림 조회 (#31 §4). 최근 30일만 조회하고 센다(물리 삭제·cron 은 후속).
 * 삭제(soft)된 공지를 가리키는 알림은 빼고 센다 — 공지 삭제 시 행을 지우는 것과 이중 방어.
 */
export const NOTIFICATION_WINDOW_DAYS = 30;
export const NOTIFICATION_LIMIT_MAX = 50;

type Executor = Db | Tx;

export function windowStart(now: Date): Date {
  return new Date(now.getTime() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** limit 파라미터 → 1..50 정수 (없거나 잘못되면 기본 20) */
export function clampLimit(raw: string | number | null | undefined): number {
  const value = typeof raw === 'number' ? raw : raw == null || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(value)) return NOTIFICATION_LIST_LIMIT;
  return Math.min(NOTIFICATION_LIMIT_MAX, Math.max(1, Math.trunc(value)));
}

/** 본인 · 30일 · 아는 type. 공지 알림은 살아 있는 공지와 연결될 때만 보인다 (left join notices) */
function visible(userId: string, now: Date): SQL {
  return and(
    eq(notifications.userId, userId),
    gte(notifications.createdAt, windowStart(now)),
    inArray(notifications.type, [...NOTIFICATION_TYPES]),
    or(
      isNull(notifications.refType),
      ne(notifications.refType, NOTIFICATION_REF.notice),
      and(isNotNull(notices.id), isNull(notices.deletedAt)),
    ),
    // 공지 알림은 공지 참조가 반드시 있어야 한다 (href /notices/{uuid} 를 만들 수 있는 행만 세고 보인다)
    or(ne(notifications.type, 'notice.created'), isNotNull(notices.id)),
  )!;
}

const noticeJoin = and(
  eq(notifications.refType, NOTIFICATION_REF.notice),
  sql`${notices.id}::text = ${notifications.refId}`,
);

export async function countUnread(db: Executor, userId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .leftJoin(notices, noticeJoin)
    .where(and(visible(userId, now), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

export async function listNotifications(
  db: Executor,
  userId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<NotificationItemView[]> {
  const now = options.now ?? new Date();
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      refId: notifications.refId,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      important: notices.isImportant,
    })
    .from(notifications)
    .leftJoin(notices, noticeJoin)
    .where(visible(userId, now))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(clampLimit(options.limit));
  const items: NotificationItemView[] = [];
  for (const row of rows) {
    if (!isNotificationType(row.type)) continue;
    const href = notificationHref(row.type, row.refId);
    if (!href) continue;
    items.push({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      href,
      createdAt: row.createdAt.toISOString(),
      read: row.readAt !== null,
      important: row.type === 'notice.created' && row.important === true,
    });
  }
  return items;
}

export async function getNotifications(
  db: Executor,
  userId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<NotificationsResponse> {
  const now = options.now ?? new Date();
  const [unreadCount, items] = await Promise.all([
    countUnread(db, userId, now),
    listNotifications(db, userId, { ...options, now }),
  ]);
  return { unreadCount, items };
}
