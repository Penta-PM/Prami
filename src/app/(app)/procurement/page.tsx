import type { Metadata } from 'next';

import { getDb } from '@/db';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { PROCUREMENT_PAGES } from '@/features/procurement/copy';
import { ProcurementHeader } from '@/features/procurement/ProcurementHeader';
import { ProcurementPlaceholder } from '@/features/procurement/ProcurementPlaceholder';
import { restoreViewState } from '@/server/page-state/restore-page';
import { requireProcurementPage } from '@/server/procurement/access';
import { getCollectionStatus } from '@/server/procurement/collection';

const PAGE = PROCUREMENT_PAGES.performance;

export const metadata: Metadata = { title: PAGE.title };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * 조달 실적 현황 (조달이 통합, procurement.read — USER·ADMIN). UI-1 은 셸(가드·머리·조회 상태 기억)만, 내용은 UI-5 가 채운다.
 */
export default async function ProcurementPerformancePage({ searchParams }: PageProps) {
  const { user, access } = await requireProcurementPage('/procurement');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 조회 상태로 redirect (page-state-memory §2.2-4)
  const viewState = await restoreViewState('procurement', params, user);
  const status = await getCollectionStatus(access, await getDb());

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <ProcurementHeader
        title={PAGE.title}
        collectedAt={status.daily.collectedAt}
        basis={PAGE.basis}
      />
      <ProcurementPlaceholder description="제품별 KPI·월 실적 보고표·월별 차트는 다음 단계에서 제공합니다." />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
