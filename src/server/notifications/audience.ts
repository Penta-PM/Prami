import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import { notifications, users } from '@/db/schema';
import type { Tx } from '@/db/tx';
import { queryRows } from '@/server/imports/sql-rows';

import {
  clampText,
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  type NotificationType,
} from './types';

/**
 * 알림 fan-out (#31 §4). 원 행위와 같은 트랜잭션(tx)에서만 호출한다 — 알림 insert 가 실패하면 원 행위도 롤백된다.
 * 수신 대상은 **활성 사용자**만, 행위를 한 본인(actorUserId)은 뺀다. 브로드캐스트는 `INSERT … SELECT` 한 문장이다.
 */
export type NotificationDraft = {
  type: NotificationType;
  title: string;
  body: string | null;
  refType: string | null;
  refId: string | null;
  /** 행위자. null 이면 사용자 행위자가 없다(뺄 사람이 없다) */
  actorUserId: string | null;
};

const col = (column: { name: string }) => sql.identifier(column.name);

/** `insert into notifications (…) select users.id, … from users where status='active' and <조건>` — 만든 행 수 */
async function insertSelect(tx: Tx, draft: NotificationDraft, condition: SQL): Promise<number> {
  const title = clampText(draft.title, NOTIFICATION_TITLE_MAX);
  const body = draft.body === null ? null : clampText(draft.body, NOTIFICATION_BODY_MAX);
  const excludeActor = draft.actorUserId
    ? sql` and ${users.id} <> ${draft.actorUserId}::uuid`
    : sql``;
  const rows = await queryRows<{ id: string }>(
    tx,
    sql`insert into ${notifications}
      (${col(notifications.userId)}, ${col(notifications.type)}, ${col(notifications.title)},
       ${col(notifications.body)}, ${col(notifications.refType)}, ${col(notifications.refId)},
       ${col(notifications.actorUserId)})
    select ${users.id}, ${draft.type}, ${title}, ${body}, ${draft.refType}, ${draft.refId},
       ${draft.actorUserId}::uuid
    from ${users}
    where ${users.status} = 'active' and ${condition}${excludeActor}
    returning ${col(notifications.id)}`,
  );
  return rows.length;
}

/** 활성 사용자 전원(행위자 제외)에게 한 행씩 */
export function insertForActiveUsers(tx: Tx, draft: NotificationDraft): Promise<number> {
  return insertSelect(tx, draft, sql`true`);
}

/** 특정 사용자 1명에게 — 그 사용자가 활성이고 행위자 본인이 아닐 때만 (0|1) */
export function insertForUser(tx: Tx, userId: string, draft: NotificationDraft): Promise<number> {
  return insertSelect(tx, draft, sql`${users.id} = ${userId}::uuid`);
}
