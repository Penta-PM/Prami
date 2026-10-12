import type { Metadata } from 'next';

import { getDb } from '@/db';
import { AuditFilters } from '@/features/audit/AuditFilters';
import { AuditPagination } from '@/features/audit/AuditPagination';
import { AuditTable } from '@/features/audit/AuditTable';
import { filterToQuery } from '@/features/audit/query';
import { getAuditLogs, listAuditActions, parseAuditFilter } from '@/server/audit/queries';
import { requirePagePermission } from '@/server/auth/rbac';

export const metadata: Metadata = { title: '감사 로그' };

type AuditPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 감사 로그 (§4.5.10, audit.read): 필터(기간·행위·사용자)·정렬은 URL 상태, 페이지 50, CSV 내보내기(화면 정렬을 따름) */
export default async function AdminAuditPage({ searchParams }: AuditPageProps) {
  const actor = await requirePagePermission('audit.read', '/admin/audit');
  const filter = parseAuditFilter(await searchParams);
  const db = await getDb();
  const [page, actions] = await Promise.all([getAuditLogs(db, filter), listAuditActions(db)]);

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          감사 로그
        </h1>
        <a
          href={`/api/audit/export.csv${filterToQuery({ ...filter, page: 1 })}`}
          className="inline-flex h-8 items-center rounded-lg bg-gray-75 px-3 text-[12px] font-semibold text-text-secondary no-underline shadow-(--hairline-subtle) hover:bg-gray-100 hover:text-ink-900 hover:no-underline"
        >
          CSV 내보내기
        </a>
      </div>
      <AuditFilters filter={filter} actions={actions} />
      <AuditTable rows={page.rows} filter={filter} userId={actor.id} />
      <AuditPagination
        filter={filter}
        page={page.page}
        pageCount={page.pageCount}
        total={page.total}
      />
    </section>
  );
}
