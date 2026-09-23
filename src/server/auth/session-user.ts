import 'server-only';

import { eq } from 'drizzle-orm';

import type { Db } from '@/db';
import { users, type User } from '@/db/schema';
import type { Role } from '@/lib/constants/permissions';

/** 세션에 싣는 사용자 정보 (JWT 에는 userId·role 만, 나머지는 DB 에서 매 요청 확인) */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string | null;
};

/** 비활성 차단·역할 변경 반영 지연 상한 (§4.6.1 "캐시 60초") */
export const SESSION_USER_TTL_MS = 60_000;

type CacheEntry = { value: SessionUser | null; expiresAt: number };

const globalForCache = globalThis as typeof globalThis & {
  __pramiSessionUserCache?: Map<string, CacheEntry>;
};
const cache = (globalForCache.__pramiSessionUserCache ??= new Map());

export function toSessionUser(user: User): SessionUser | null {
  if (user.status !== 'active') return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    department: user.department,
  };
}

/**
 * 활성 사용자를 조회한다 (60초 캐시). 없거나 비활성이면 null → 호출자가 세션을 무효화한다.
 * 같은 프로세스의 사용자 변경(역할·비활성화)은 invalidateSessionUser 로 즉시 반영한다.
 */
export async function loadSessionUser(
  db: Db,
  userId: string,
  now: number = Date.now(),
): Promise<SessionUser | null> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.value;
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const value = row ? toSessionUser(row) : null;
  cache.set(userId, { value, expiresAt: now + SESSION_USER_TTL_MS });
  return value;
}

export function invalidateSessionUser(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
