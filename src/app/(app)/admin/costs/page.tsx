import type { Metadata } from 'next';

import { Pill } from '@/components/ui';
import { getDb } from '@/db';
import { CostBrowser } from '@/features/costs/CostBrowser';
import { CostFilters } from '@/features/costs/CostFilters';
import { CostImportPanel } from '@/features/costs/CostImportPanel';
import { CostPagination } from '@/features/costs/CostPagination';
import { formatAuditTime } from '@/lib/audit-format';
import { requireCostPageAccess } from '@/server/cost/access';
import { parseCostFilter } from '@/server/cost/filter';
import {
  getCostRows,
  getCurrentCostApply,
  listCostFamilies,
  listCostYears,
} from '@/server/cost/queries';
import { listReusableBatches } from '@/server/imports/queries';

export const metadata: Metadata = { title: '원가 관리' };

type AdminCostsPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * 원가 관리 (§4.5.5, ADMIN 전용). proxy(1차) → requirePagePermission('cost.read')(2차, 거부 시 감사 denied + /).
 * 원가 값은 이 페이지와 features/costs Action 응답에만 실린다.
 */
export default async function AdminCostsPage({ searchParams }: AdminCostsPageProps) {
  const access = await requireCostPageAccess('/admin/costs');
  const { filter, errors } = parseCostFilter(await searchParams);
  const db = await getDb();
  const [page, families, years, current, options] = await Promise.all([
    getCostRows(access, db, filter),
    listCostFamilies(access, db),
    listCostYears(access, db),
    getCurrentCostApply(access, db),
    listReusableBatches(db, 'material_cost'),
  ]);

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          원가 관리
        </h1>
        {current ? (
          <Pill tone="positive" aria-label="현재 적용">
            현재 적용: {current.fileName}({formatAuditTime(new Date(current.appliedAt))})
          </Pill>
        ) : (
          <Pill tone="neutral">현재 적용: 없음</Pill>
        )}
      </div>
      <p className="m-0 text-[12px] text-text-tertiary">
        이 화면과 원가 데이터는 관리자에게만 노출됩니다. 일반 사용자 API는 서버단에서 반환을
        차단합니다.
      </p>
      <CostImportPanel options={options} currentBatchId={current?.batchId ?? null} />
      <CostFilters filter={filter} errors={errors} families={families} years={years} />
      <CostBrowser rows={page.rows} />
      <CostPagination
        filter={filter}
        page={page.page}
        pageCount={page.pageCount}
        total={page.total}
      />
    </section>
  );
}
