import 'server-only';

import { getDb } from '@/db';
import { loadPolicyCostRatios } from '@/features/costs/price-ratios';
import { getCategoryOptions } from '@/server/pricing/categories';
import {
  getPriceRows,
  listEffectiveYears,
  listPriceCurrencies,
  listPriceTypes,
} from '@/server/pricing/queries';

import { priceFilterDefs } from './column-filters';
import type { TableMode } from './columns';
import { parsePriceFilter } from './filter';
import { PricingBrowser } from './PricingBrowser';
import { PricingFilters } from './PricingFilters';
import { PricingPagination } from './PricingPagination';

type Params = Record<string, string | string[] | undefined>;

/**
 * 조회·관리 공용 섹션 (서버 컴포넌트): URL 필터 → 분류 옵션·연도 칩·페이지 데이터 → 필터 + 표 + 페이지.
 * 조회(/pricing)와 관리(/admin/policies)가 같은 컬럼 정의·필터를 쓰고 mode 만 다르다 (R-03).
 */
export async function PricingSection({
  mode,
  basePath,
  searchParams,
  userId,
}: {
  mode: TableMode;
  basePath: string;
  searchParams: Params;
  /** 로그인 사용자 id — 표 열 너비·순서 저장 키 (#32 스펙 §5) */
  userId: string;
}) {
  const db = await getDb();
  // 통화·단가 유형 열 필터 선택지(데이터)가 화이트리스트에 들어가므로 먼저 읽고 URL 을 파싱한다 (표 열 필터 스펙 §2.3·§7 Q3 B)
  const [currencies, priceTypes, years] = await Promise.all([
    listPriceCurrencies(db),
    listPriceTypes(db),
    listEffectiveYears(db),
  ]);
  const { filter, errors } = parsePriceFilter(
    searchParams,
    priceFilterDefs(currencies, priceTypes),
  );
  const [options, page] = await Promise.all([
    getCategoryOptions(db, { major: filter.major, mid: filter.mid, family: filter.family }),
    getPriceRows(db, filter),
  ]);
  // 원가 비중: 관리 표에서만, cost.read 가 있을 때만(없으면 null → prop 자체를 넘기지 않음 — RSC payload 에 costRatio 키 0).
  // 현재 페이지 행 id 만 계산한다(cost-ratio-price-change §2.2-1). 조회 표(/pricing)는 부르지 않는다
  const costRatios =
    mode === 'admin' ? await loadPolicyCostRatios(page.rows.map((row) => row.id)) : null;
  return (
    <div className="flex flex-col gap-4">
      <PricingFilters
        // 검색어 입력은 로컬 상태 — '필터 초기화' 등으로 q 가 바뀌면 새로 그려 입력값을 URL 과 맞춘다
        key={filter.q ?? ''}
        filter={filter}
        errors={errors}
        options={options}
        years={years}
        searchPlaceholder={mode === 'admin' ? '모델명, 코드로 검색' : '모델명으로 검색'}
      />
      <PricingBrowser
        mode={mode}
        rows={page.rows}
        filter={filter}
        total={page.total}
        currencies={currencies}
        priceTypes={priceTypes}
        userId={userId}
        {...(costRatios ? { costRatios } : {})}
      />
      <PricingPagination
        basePath={basePath}
        filter={filter}
        page={page.page}
        pageCount={page.pageCount}
        total={page.total}
      />
    </div>
  );
}
