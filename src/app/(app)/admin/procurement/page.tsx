import type { Metadata } from 'next';

import { getDb } from '@/db';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { PROCUREMENT_PAGES } from '@/features/procurement/copy';
import { ProcurementAdminTabs } from '@/features/procurement/ProcurementAdminTabs';
import { ProcurementHeader } from '@/features/procurement/ProcurementHeader';
import { parseProcurementAdminTab } from '@/lib/procurement/admin-tabs';
import { restoreViewState } from '@/server/page-state/restore-page';
import { requireProcurementPage } from '@/server/procurement/access';
import { getCollectionStatus } from '@/server/procurement/collection';

const PAGE = PROCUREMENT_PAGES.admin;

export const metadata: Metadata = { title: PAGE.title };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * 조달 관리 (조달이 통합 D-2, procurement.write = ADMIN): 탭 3개(실적 관리·품목 관리·키워드 관리), `?tab=` 은 URL·조회 상태.
 * UI-1 은 셸만 — 탭 내용·쓰기는 단계 3(UI-6~8).
 */
export default async function AdminProcurementPage({ searchParams }: PageProps) {
  const { user, access } = await requireProcurementPage('/admin/procurement', 'write');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 탭으로 redirect (page-state-memory §2.2-4·7)
  const viewState = await restoreViewState('admin-procurement', params, user);
  const status = await getCollectionStatus(access, await getDb());
  const tab = parseProcurementAdminTab(params.tab);

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <ProcurementHeader
        title={PAGE.title}
        collectedAt={status.daily.collectedAt}
        basis={PAGE.basis}
      />
      <ProcurementAdminTabs initialTab={tab} />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
