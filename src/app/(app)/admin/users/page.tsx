import type { Metadata } from 'next';

import { getDb } from '@/db';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { PermissionMatrix } from '@/features/users/PermissionMatrix';
import { UsersTable } from '@/features/users/UsersTable';
import { requirePagePermission } from '@/server/auth/rbac';
import { restoreViewState } from '@/server/page-state/restore-page';
import { listUsers } from '@/server/users/queries';

export const metadata: Metadata = { title: '사용자 · 권한' };

type AdminUsersPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 사용자·권한 관리 (§4.5.10, users.manage). 표 열 필터·정렬은 URL 상태(클라이언트 표) — 재진입 시 저장 상태 복원 */
export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const actor = await requirePagePermission('users.manage', '/admin/users');
  const viewState = await restoreViewState('admin-users', await searchParams, actor);
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
      <ViewStateTracker {...viewState} />
    </section>
  );
}
