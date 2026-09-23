import type { Metadata } from 'next';

import { getDb } from '@/db';
import { PermissionMatrix } from '@/features/users/PermissionMatrix';
import { UsersTable } from '@/features/users/UsersTable';
import { requirePagePermission } from '@/server/auth/rbac';
import { listUsers } from '@/server/users/queries';

export const metadata: Metadata = { title: '사용자 · 권한' };

/** 사용자·권한 관리 (§4.5.10, users.manage) */
export default async function AdminUsersPage() {
  const actor = await requirePagePermission('users.manage', '/admin/users');
  const users = await listUsers(await getDb());

  return (
    <section aria-labelledby="page-title" className="flex flex-col">
      <UsersTable
        currentUserId={actor.id}
        users={users.map((user) => ({
          ...user,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        }))}
      />
      <PermissionMatrix />
    </section>
  );
}
