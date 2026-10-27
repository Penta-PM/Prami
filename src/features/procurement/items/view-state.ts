import 'server-only';

import type { Db } from '@/db';
import { optionalProcurementReadAccess } from '@/server/procurement/access';
import { getProcurementItemFacets } from '@/server/procurement/queries';

import {
  hasChoiceFilterParams,
  itemFilterDefs,
  itemsViewToQuery,
  NO_ITEM_CHOICES,
  parseItemsView,
  type ItemFilterChoices,
} from './filter';

type Params = Record<string, string | string[] | undefined>;

/** facets(값 + 건수) → 열 필터 선택지 (값만) */
export function choicesOf(facets: {
  products: readonly { value: string }[];
  detailCategories: readonly { value: string }[];
  manufacturers: readonly { value: string }[];
}): ItemFilterChoices {
  return {
    products: facets.products.map((facet) => facet.value),
    detailCategories: facets.detailCategories.map((facet) => facet.value),
    manufacturers: facets.manufacturers.map((facet) => facet.value),
  };
}

/**
 * 등록 품목(/procurement/items) 조회 상태 정규화 (page-state-memory §2.2-3·4, page_key `procurement-items`). 화면과 같은 파서·화이트리스트
 * (제품·세부분류·제조사 선택지 = 현재 데이터)를 통과한 쿼리만 남긴다('?' 없음).
 * - enum 조건이 없으면 DB 를 읽지 않는다(검색·등록일자·계약단가·정렬·페이지는 데이터와 무관한 형식 검증만).
 * - enum 조건이 있는데 세션 사용자에게 procurement.read 가 없으면 '' (권한 강등 뒤 복원하지 않음 — §2.7-1).
 * 조달 모듈 격리(DB-2) 때문에 server/page-state 가 아니라 features/procurement 에 둔다(원가 view-state 와 같은 배치).
 */
export async function normalizeProcurementItemsQuery(db: Db, params: Params): Promise<string> {
  let choices = NO_ITEM_CHOICES;
  if (hasChoiceFilterParams(params)) {
    const access = await optionalProcurementReadAccess();
    if (!access) return '';
    choices = choicesOf(await getProcurementItemFacets(access, db));
  }
  const query = itemsViewToQuery(parseItemsView(params, itemFilterDefs(choices)));
  return query.startsWith('?') ? query.slice(1) : query;
}
