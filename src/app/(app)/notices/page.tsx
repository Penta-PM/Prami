import type { Metadata } from 'next';

import { getDb } from '@/db';
import { NoticeRows } from '@/features/notices/NoticeRows';
import { requirePagePermission } from '@/server/auth/rbac';
import { listNotices } from '@/server/notices/queries';

export const metadata: Metadata = { title: '공지사항' };

/** 공지사항 전체 (§4.5.4, notice.read = 로그인 사용자 모두) */
export default async function NoticesPage() {
  await requirePagePermission('notice.read', '/notices');
  const rows = await listNotices(await getDb());
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-[18px]">
      <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
        공지사항
      </h1>
      <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
        <NoticeRows notices={rows} />
      </div>
    </section>
  );
}
