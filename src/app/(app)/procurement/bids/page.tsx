import type { Metadata } from 'next';

import { getDb } from '@/db';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { BidEmpty } from '@/features/procurement/bids/BidEmpty';
import { BidFilterBar } from '@/features/procurement/bids/BidFilterBar';
import { BidPagination } from '@/features/procurement/bids/BidPagination';
import { BidTable } from '@/features/procurement/bids/BidTable';
import { PROCUREMENT_PAGES } from '@/features/procurement/copy';
import { formatCollectedAt, ProcurementHeader } from '@/features/procurement/ProcurementHeader';
import { parseBidFilter } from '@/lib/procurement/bid-filter';
import { restoreViewState } from '@/server/page-state/restore-page';
import { requireProcurementPage } from '@/server/procurement/access';
import { getBidNoticeRows } from '@/server/procurement/bids';
import { getCollectionStatus } from '@/server/procurement/collection';

const PAGE = PROCUREMENT_PAGES.bids;

export const metadata: Metadata = { title: PAGE.title };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * 입찰 공고 (조달이 통합 UI-3, procurement.read). 머리 수집 시각은 입찰 공고 수집 작업(bids) 기준 + 마지막 확인 시각(app_state).
 * 조건(제품·마감 포함·정렬·상만·페이지)은 URL 이 상태이고(lib/procurement/bid-filter), 표는 서버 페이지네이션(getBidNoticeRows).
 */
export default async function ProcurementBidsPage({ searchParams }: PageProps) {
  const { user, access } = await requireProcurementPage('/procurement/bids');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 조회 상태로 redirect (page-state-memory §2.2-4)
  const viewState = await restoreViewState('procurement-bids', params, user);
  const filter = parseBidFilter(params);
  const db = await getDb();
  const [status, result] = await Promise.all([
    getCollectionStatus(access, db),
    getBidNoticeRows(access, db, {
      product: filter.product,
      includeClosed: filter.includeClosed,
      topGradeOnly: filter.topGradeOnly,
      sort: filter.sort,
      page: filter.page,
    }),
  ]);
  const shown = { ...filter, page: result.page };

  return (
    <section aria-labelledby="page-title" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <ProcurementHeader
          title={PAGE.title}
          collectedAt={status.bids.collectedAt}
          basis={PAGE.basis}
        />
        <dl className="m-0 flex gap-1.5 text-[12px] text-text-tertiary">
          <dt className="font-semibold">마지막 확인 시각</dt>
          <dd className="m-0 tabular-nums" data-testid="procurement-bids-last-checked">
            {status.bidsLastCheckedAt ? (
              <time dateTime={status.bidsLastCheckedAt.toISOString()}>
                {formatCollectedAt(status.bidsLastCheckedAt)}
              </time>
            ) : (
              '확인 기록 없음'
            )}
          </dd>
        </dl>
      </div>
      <BidFilterBar
        filter={shown}
        productCounts={result.productCounts}
        allCount={result.allCount}
      />
      {result.rows.length === 0 ? (
        <BidEmpty filter={shown} allCount={result.allCount} />
      ) : (
        <>
          <div className="min-w-0 rounded-2xl bg-surface-card shadow-(--hairline-subtle)">
            <BidTable rows={result.rows} />
          </div>
          <BidPagination
            filter={shown}
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
          />
        </>
      )}
      <ViewStateTracker {...viewState} />
    </section>
  );
}
