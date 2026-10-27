import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { getDb } from '@/db';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { DeliveriesAdminSection } from '@/features/procurement/admin/deliveries/DeliveriesAdminSection';
import { ItemsAdminSection } from '@/features/procurement/admin/items/ItemsAdminSection';
import { KeywordsAdminSection } from '@/features/procurement/admin/keywords/KeywordsAdminSection';
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
 * 조달 관리 (조달이 통합 D-2, procurement.write = ADMIN): 탭 3개(실적 관리·품목 관리·키워드 관리).
 * 탭 상태는 URL `?tab=`, 탭 내용은 이 RSC 가 searchParams 로 서버에서 읽는다(Plan msg_9f2035d66cd8) — 탭마다 switch 한 줄.
 */
export default async function AdminProcurementPage({ searchParams }: PageProps) {
  const { user, access } = await requireProcurementPage('/admin/procurement', 'write');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 탭으로 redirect (page-state-memory §2.2-4·7)
  const viewState = await restoreViewState('admin-procurement', params, user);
  const status = await getCollectionStatus(access, await getDb());
  const tab = parseProcurementAdminTab(params.tab);

  let section: ReactNode;
  switch (tab) {
    case 'deliveries':
      section = <DeliveriesAdminSection params={params} access={access} user={user} />;
      break;
    case 'items':
      section = <ItemsAdminSection params={params} access={access} user={user} />;
      break;
    case 'keywords':
      section = <KeywordsAdminSection params={params} access={access} user={user} />;
      break;
  }

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <ProcurementHeader
        title={PAGE.title}
        collectedAt={status.daily.collectedAt}
        basis={PAGE.basis}
      />
      <ProcurementAdminTabs tab={tab}>{section}</ProcurementAdminTabs>
      <ViewStateTracker {...viewState} />
    </section>
  );
}
