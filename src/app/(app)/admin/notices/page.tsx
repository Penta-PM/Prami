import type { Metadata } from 'next';

import { getDb } from '@/db';
import { NoticesAdminTable } from '@/features/notices/NoticesAdminTable';
import { requirePagePermission } from '@/server/auth/rbac';
import { listNoticesWithBody } from '@/server/notices/queries';

export const metadata: Metadata = { title: '공지사항 관리' };

/** 공지사항 관리 (§4.5.4, notice.write = ADMIN). proxy(1차) + admin layout + 페이지 가드(2차) */
export default async function AdminNoticesPage() {
  const actor = await requirePagePermission('notice.write', '/admin/notices');
  const rows = await listNoticesWithBody(await getDb());
  return (
    <section aria-labelledby="page-title" className="flex flex-col">
      <NoticesAdminTable notices={rows} defaultAuthor={actor.name} userId={actor.id} />
    </section>
  );
}
