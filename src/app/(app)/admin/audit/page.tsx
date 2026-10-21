import type { Metadata } from 'next';

import { getDb } from '@/db';
import { AuditPagination } from '@/features/audit/AuditPagination';
import { AuditTable } from '@/features/audit/AuditTable';
import { filterToQuery } from '@/features/audit/query';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { getAuditLogs, listAuditActions, parseAuditFilter } from '@/server/audit/queries';
import { requirePagePermission } from '@/server/auth/rbac';
import { restoreViewState } from '@/server/page-state/restore-page';

export const metadata: Metadata = { title: '감사 로그' };

type AuditPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * 감사 로그 (§4.5.10, audit.read): 열 필터(기간·행위·사용자 = 기존 파라미터 별칭, 대상·IP·결과)·정렬은 URL 상태, 페이지 50,
 * CSV 내보내기(화면과 같은 필터·정렬 — 같은 filterToQuery·parseAuditFilter·WHERE)
 */
export default async function AdminAuditPage({ searchParams }: AuditPageProps) {
  const actor = await requirePagePermission('audit.read', '/admin/audit');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 조회 상태로 redirect (page-state-memory §2.2-4)
  const viewState = await restoreViewState('admin-audit', params, actor);
  const filter = parseAuditFilter(params);
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
      <AuditTable
        rows={page.rows}
        filter={filter}
        actions={actions}
        total={page.total}
        userId={actor.id}
      />
      <AuditPagination
        filter={filter}
        page={page.page}
        pageCount={page.pageCount}
        total={page.total}
      />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
