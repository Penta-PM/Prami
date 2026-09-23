import { and, count, eq } from 'drizzle-orm';

import type { Db } from '@/db';
import { users } from '@/db/schema';

export const NO_ADMIN_WARNING =
  '[auth] ADMIN_EMAILS 가 비어 있고 활성 ADMIN 이 0명입니다. 아무도 관리 화면에 들어갈 수 없습니다 — ADMIN_EMAILS 를 설정하세요 (§4.6.1)';

/** 기동 시 점검: ADMIN_EMAILS 가 비어 있고 활성 ADMIN 이 없으면 경고를 남긴다. 경고했으면 true */
export async function warnIfNoAdmin(
  db: Db,
  adminEmails: readonly string[],
  warn: (message: string) => void = console.warn,
): Promise<boolean> {
  if (adminEmails.length > 0) return false;
  const [row] = await db
    .select({ admins: count() })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.status, 'active')));
  if ((row?.admins ?? 0) > 0) return false;
  warn(NO_ADMIN_WARNING);
  return true;
}
