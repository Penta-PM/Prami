import type { Metadata } from 'next';

import { getDb } from '@/db';
import { NoticesAdminTable } from '@/features/notices/NoticesAdminTable';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { requirePagePermission } from '@/server/auth/rbac';
import { listNoticesWithBody } from '@/server/notices/queries';
import { restoreViewState } from '@/server/page-state/restore-page';

export const metadata: Metadata = { title: '공지사항 관리' };

type AdminNoticesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 공지사항 관리 (§4.5.4, notice.write = ADMIN). proxy(1차) + admin layout + 페이지 가드(2차). 표 URL 상태는 재진입 시 복원 */
export default async function AdminNoticesPage({ searchParams }: AdminNoticesPageProps) {
  const actor = await requirePagePermission('notice.write', '/admin/notices');
  const viewState = await restoreViewState('admin-notices', await searchParams, actor);
  const rows = await listNoticesWithBody(await getDb());
  return (
    <section aria-labelledby="page-title" className="flex flex-col">
      <NoticesAdminTable notices={rows} defaultAuthor={actor.name} userId={actor.id} />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
