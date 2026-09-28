import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getDb } from '@/db';
import { hasPermission } from '@/lib/constants/permissions';
import { NoticeDetailActions } from '@/features/notices/NoticeDetailActions';
import { ImportantBadge } from '@/features/notices/NoticeRows';
import { requirePagePermission } from '@/server/auth/rbac';
import { getNotice } from '@/server/notices/queries';

export const metadata: Metadata = { title: '공지사항' };

type NoticeDetailPageProps = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 공지 상세 (디자인 "공지사항 상세"). ADMIN 에게만 수정/삭제 (AC-51) */
export default async function NoticeDetailPage({ params }: NoticeDetailPageProps) {
  const { id } = await params;
  const user = await requirePagePermission('notice.read', `/notices/${id}`);
  if (!UUID.test(id)) notFound();
  const notice = await getNotice(await getDb(), id);
  if (!notice) notFound();
  const canManage = hasPermission(user.role, 'notice.write');

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <Link href="/notices" className="text-[12px] font-semibold text-text-tertiary">
        ← 목록으로
      </Link>
      <article className="rounded-xl bg-surface-card p-8 shadow-(--hairline-default)">
        <div className="mb-3 flex items-center gap-2 text-[12px] text-text-tertiary">
          {notice.isImportant ? <ImportantBadge /> : null}
          <span>
            {notice.publishedAt} · {notice.authorName}
          </span>
        </div>
        <h1 id="page-title" className="m-0 mb-5 [font:var(--text-page-title)]">
          {notice.title}
        </h1>
        <div className="border-t border-border-subtle pt-5 text-[14px] leading-[1.8] whitespace-pre-line text-text-secondary">
          {notice.body}
        </div>
        {canManage ? <NoticeDetailActions notice={notice} defaultAuthor={user.name} /> : null}
      </article>
    </section>
  );
}
