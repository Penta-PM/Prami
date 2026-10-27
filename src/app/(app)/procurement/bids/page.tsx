import type { Metadata } from 'next';

import { getDb } from '@/db';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { PROCUREMENT_PAGES } from '@/features/procurement/copy';
import { ProcurementHeader } from '@/features/procurement/ProcurementHeader';
import { ProcurementPlaceholder } from '@/features/procurement/ProcurementPlaceholder';
import { restoreViewState } from '@/server/page-state/restore-page';
import { requireProcurementPage } from '@/server/procurement/access';
import { getCollectionStatus } from '@/server/procurement/collection';

const PAGE = PROCUREMENT_PAGES.bids;

export const metadata: Metadata = { title: PAGE.title };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 입찰 공고 (조달이 통합, procurement.read). 머리 수집 시각은 입찰 공고 수집 작업(bids) 기준. 표는 UI-3 이 채운다 */
export default async function ProcurementBidsPage({ searchParams }: PageProps) {
  const { user, access } = await requireProcurementPage('/procurement/bids');
  const params = await searchParams;
  const viewState = await restoreViewState('procurement-bids', params, user);
  const status = await getCollectionStatus(access, await getDb());

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <ProcurementHeader
        title={PAGE.title}
        collectedAt={status.bids.collectedAt}
        basis={PAGE.basis}
      />
      <ProcurementPlaceholder description="제품별 입찰 공고·적합도·마감 D-day 는 다음 단계에서 제공합니다." />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
