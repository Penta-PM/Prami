import 'server-only';

import { getDb } from '@/db';
import { getCategoryOptions } from '@/server/pricing/categories';
import { getPriceRows, listEffectiveYears } from '@/server/pricing/queries';

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
}: {
  mode: TableMode;
  basePath: string;
  searchParams: Params;
}) {
  const { filter, errors } = parsePriceFilter(searchParams);
  const db = await getDb();
  const [options, years, page] = await Promise.all([
    getCategoryOptions(db, { major: filter.major, mid: filter.mid }),
    listEffectiveYears(db),
    getPriceRows(db, filter),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <PricingFilters
        filter={filter}
        errors={errors}
        options={options}
        years={years}
        searchPlaceholder={mode === 'admin' ? '모델명, 코드로 검색' : '모델명으로 검색'}
      />
      <PricingBrowser mode={mode} rows={page.rows} />
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
