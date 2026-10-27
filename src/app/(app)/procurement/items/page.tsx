import type { Metadata } from 'next';

import { getDb } from '@/db';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { PROCUREMENT_PAGES } from '@/features/procurement/copy';
import { ProcurementHeader } from '@/features/procurement/ProcurementHeader';
import { ProcurementPlaceholder } from '@/features/procurement/ProcurementPlaceholder';
import { restoreViewState } from '@/server/page-state/restore-page';
import { requireProcurementPage } from '@/server/procurement/access';
import { getCollectionStatus } from '@/server/procurement/collection';

const PAGE = PROCUREMENT_PAGES.items;

export const metadata: Metadata = { title: PAGE.title };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 등록 품목 (조달이 통합, procurement.read). UI-1 은 셸만, 표·필터·내려받기는 UI-2 가 채운다 */
export default async function ProcurementItemsPage({ searchParams }: PageProps) {
  const { user, access } = await requireProcurementPage('/procurement/items');
  const params = await searchParams;
  const viewState = await restoreViewState('procurement-items', params, user);
  const status = await getCollectionStatus(access, await getDb());

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <ProcurementHeader
        title={PAGE.title}
        collectedAt={status.daily.collectedAt}
        basis={PAGE.basis}
      />
      <ProcurementPlaceholder description="등록 품목 표·빠른 필터·xlsx 내려받기는 다음 단계에서 제공합니다." />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
