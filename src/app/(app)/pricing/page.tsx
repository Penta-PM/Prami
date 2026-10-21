import type { Metadata } from 'next';

import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { PricingSection } from '@/features/pricing/PricingSection';
import { requirePagePermission } from '@/server/auth/rbac';
import { restoreViewState } from '@/server/page-state/restore-page';

export const metadata: Metadata = { title: '가격 정책 조회' };

type PricingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 가격 정책 조회 (§4.5.3, USER 이상): 적용기간만 표시(R-12), 분류·날짜·검색 필터는 URL 상태 */
export default async function PricingPage({ searchParams }: PricingPageProps) {
  const actor = await requirePagePermission('pricing.read', '/pricing');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 조회 상태로 redirect (page-state-memory §2.2-4)
  const viewState = await restoreViewState('pricing', params, actor);
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
        가격 정책 조회
      </h1>
      <PricingSection mode="view" basePath="/pricing" searchParams={params} userId={actor.id} />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
