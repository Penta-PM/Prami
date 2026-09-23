import 'server-only';

import { asc, desc } from 'drizzle-orm';

import type { Db } from '@/db';
import { users } from '@/db/schema';

export type UserListRow = {
  id: string;
  email: string;
  name: string;
  department: string | null;
  role: 'USER' | 'ADMIN';
  status: 'active' | 'inactive';
  createdVia: 'bootstrap' | 'auto' | 'admin';
  lastLoginAt: Date | null;
};

/** 사용자 표 (§4.5.10). 사내 사용자 규모(수백 명)라 전체를 한 번에 조회한다 */
export async function listUsers(db: Db): Promise<UserListRow[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      department: users.department,
      role: users.role,
      status: users.status,
      createdVia: users.createdVia,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(asc(users.status), desc(users.role), asc(users.name));
}
