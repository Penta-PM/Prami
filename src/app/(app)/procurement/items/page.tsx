import type { Metadata } from 'next';

import { getDb } from '@/db';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { PROCUREMENT_PAGES } from '@/features/procurement/copy';
import {
  itemFilterDefs,
  parseItemsView,
  toItemQueryFilter,
} from '@/features/procurement/items/filter';
import { ItemsBrowser } from '@/features/procurement/items/ItemsBrowser';
import { ItemsExportLink } from '@/features/procurement/items/ItemsExportLink';
import { ItemsPagination } from '@/features/procurement/items/ItemsPagination';
import { choicesOf } from '@/features/procurement/items/view-state';
import { ProcurementHeader } from '@/features/procurement/ProcurementHeader';
import { restoreViewState } from '@/server/page-state/restore-page';
import { requireProcurementPage } from '@/server/procurement/access';
import { getCollectionStatus } from '@/server/procurement/collection';
import {
  getProcurementItemFacets,
  getProcurementItemPriceRange,
  getProcurementItemRows,
  PROCUREMENT_ITEM_EXPORT_LIMIT,
} from '@/server/procurement/queries';

const PAGE = PROCUREMENT_PAGES.items;

export const metadata: Metadata = { title: PAGE.title };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * 등록 품목 (조달이 통합 UI-2, procurement.read — USER·ADMIN). 서버 정렬·필터·페이지네이션(브라우저는 한 페이지만 받는다),
 * 빠른 필터 바(고정: 제품·세부분류·제조사, 계약단가 로그 슬라이더), xlsx 내려받기(현재 필터 결과). URL 이 상태다.
 */
export default async function ProcurementItemsPage({ searchParams }: PageProps) {
  const { user, access } = await requireProcurementPage('/procurement/items');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 조회 상태로 redirect (page-state-memory §2.2-4)
  const viewState = await restoreViewState('procurement-items', params, user);
  const db = await getDb();
  // 제품·세부분류·제조사 선택지(데이터)가 화이트리스트에 들어가므로 먼저 읽고 URL 을 파싱한다 (표 열 필터 스펙 §2.3)
  const facets = await getProcurementItemFacets(access, db);
  const choices = choicesOf(facets);
  const view = parseItemsView(params, itemFilterDefs(choices));
  const [result, priceRange, status] = await Promise.all([
    getProcurementItemRows(access, db, toItemQueryFilter(view)),
    getProcurementItemPriceRange(access, db),
    getCollectionStatus(access, db),
  ]);
  // 범위를 넘은 page 는 조회 계층이 마지막 페이지로 맞춘다 — 링크·정렬도 그 페이지 기준
  const current = { ...view, page: result.page };

  return (
    <section aria-labelledby="page-title" className="flex min-w-0 flex-col gap-4">
      <ProcurementHeader
        title={PAGE.title}
        collectedAt={status.daily.collectedAt}
        runs={[status.daily, status.bids]}
        basis={PAGE.basis}
        actions={
          <ItemsExportLink
            view={current}
            total={result.total}
            limit={PROCUREMENT_ITEM_EXPORT_LIMIT}
          />
        }
      />
      <ItemsBrowser
        rows={result.rows}
        view={current}
        total={result.total}
        choices={choices}
        priceRange={priceRange}
        userId={user.id}
      />
      <ItemsPagination
        view={current}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
      />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
