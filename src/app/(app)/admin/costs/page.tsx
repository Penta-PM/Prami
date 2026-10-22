import type { Metadata } from 'next';
import Link from 'next/link';

import { Pill } from '@/components/ui';
import { getDb } from '@/db';
import { CostBrowser } from '@/features/costs/CostBrowser';
import { CostFilters } from '@/features/costs/CostFilters';
import { CostImportPanel } from '@/features/costs/CostImportPanel';
import { CostPagination } from '@/features/costs/CostPagination';
import { costFilterDefs } from '@/features/costs/column-filters';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { formatAuditTime } from '@/lib/audit-format';
import { getSessionUser } from '@/server/auth/rbac';
import { requireCostPageAccess } from '@/server/cost/access';
import { parseCostFilter } from '@/server/cost/filter';
import {
  getCostRows,
  getCurrentCostApply,
  listCostCurrencies,
  listCostCurrencyRanges,
  listCostFamilies,
  listCostYears,
} from '@/server/cost/queries';
import { listReusableBatches } from '@/server/imports/queries';
import { restoreViewState } from '@/server/page-state/restore-page';

/** 이 페이지의 Server Action(임포트 적용: 5,885행 전체 교체)이 쓰는 함수 상한 — §4.8 maxDuration=60 */
export const maxDuration = 60;

export const metadata: Metadata = { title: '원가 관리' };

type AdminCostsPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * 원가 관리 (§4.5.5, ADMIN 전용). proxy(1차) → requirePagePermission('cost.read')(2차, 거부 시 감사 denied + /).
 * 원가 값은 이 페이지와 features/costs Action 응답에만 실린다.
 */
export default async function AdminCostsPage({ searchParams }: AdminCostsPageProps) {
  const access = await requireCostPageAccess('/admin/costs');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 조회 상태로 redirect (page-state-memory §2.2-4). 접근 확인을 통과했으니 세션 사용자가 있다
  const sessionUser = await getSessionUser();
  const viewState = sessionUser ? await restoreViewState('admin-costs', params, sessionUser) : null;
  const db = await getDb();
  // 통화 열 필터 선택지(데이터)가 화이트리스트에 들어가므로 먼저 읽고 URL 을 파싱한다 (표 열 필터 스펙 §2.3)
  const currencies = await listCostCurrencies(access, db);
  const { filter, errors } = parseCostFilter(params, costFilterDefs(currencies));
  // 원가 슬라이더 범위(통화별 표 전체 최소·최대, cost.read — 빠른 필터 바 §7.5)는 이 화면 props 로만 내려간다
  const [page, families, years, current, options, costRanges] = await Promise.all([
    getCostRows(access, db, filter),
    listCostFamilies(access, db),
    listCostYears(access, db),
    getCurrentCostApply(access, db),
    listReusableBatches(db, 'material_cost'),
    listCostCurrencyRanges(access, db),
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
        <Link
          href="/admin/costs/links"
          className="ml-auto rounded-pill bg-gray-75 px-3 py-1.5 text-[12px] font-semibold text-text-secondary shadow-(--hairline-subtle) hover:text-ink-900"
        >
          원가 매핑
        </Link>
      </div>
      <p className="m-0 text-[12px] text-text-tertiary">
        이 화면과 원가 데이터는 관리자에게만 노출됩니다. 일반 사용자 API는 서버단에서 반환을
        차단합니다.
      </p>
      {/* 페이지 접근은 세션 사용자만 통과하므로 userId 는 항상 있다 (null 은 세션 없는 스크립트용) */}
      <CostImportPanel
        userId={access.userId ?? ''}
        options={options}
        currentBatchId={current?.batchId ?? null}
      />
      <CostBrowser
        // 기존 페이지 필터(제품군 탭·기간·검색)는 빠른 필터 바와 같은 카드 안, 바 위 (빠른 필터 바 §2.5)
        leading={
          <CostFilters
            // 검색어 입력은 로컬 상태 — '필터 초기화' 등으로 q 가 바뀌면 새로 그려 입력값을 URL 과 맞춘다
            key={filter.q ?? ''}
            filter={filter}
            errors={errors}
            families={families}
            years={years}
          />
        }
        rows={page.rows}
        filter={filter}
        total={page.total}
        currencies={currencies}
        costRanges={costRanges}
        userId={access.userId ?? ''}
      />
      <CostPagination
        filter={filter}
        page={page.page}
        pageCount={page.pageCount}
        total={page.total}
      />
      {viewState ? <ViewStateTracker {...viewState} /> : null}
    </section>
  );
}
