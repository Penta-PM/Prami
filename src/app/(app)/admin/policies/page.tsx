import type { Metadata } from 'next';

import { Pill } from '@/components/ui';
import { getDb } from '@/db';
import { formatAuditTime } from '@/lib/audit-format';
import { ImportPanel } from '@/features/admin-policies/ImportPanel';
import { PricingSection } from '@/features/pricing/PricingSection';
import { requirePagePermission } from '@/server/auth/rbac';
import {
  getCurrentApply,
  listRecentRuns,
  listReusableBatches,
  type CurrentApply,
  type RecentRun,
} from '@/server/imports/queries';

/** 이 페이지의 Server Action(임포트 적용: 5,885행 전체 교체)이 쓰는 함수 상한 — §4.8 maxDuration=60 */
export const maxDuration = 60;

export const metadata: Metadata = { title: '가격정책 관리' };

/**
 * 가격정책 관리 (§4.5.3): 상단 임포트 패널(판매단가/품목상태 파일 → 가격정책 적용)·현재 적용 배지,
 * 아래 관리 표(조회 표 + 적용시작일·운영 연도·관리)·필터·`+ 등록`/수정/복사/삭제.
 */
type AdminPoliciesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminPoliciesPage({ searchParams }: AdminPoliciesPageProps) {
  await requirePagePermission('pricing.write', '/admin/policies');
  const db = await getDb();
  const [current, salesOptions, itemOptions, runs] = await Promise.all([
    getCurrentApply(db),
    listReusableBatches(db, 'sales_price'),
    listReusableBatches(db, 'item_master'),
    listRecentRuns(db),
  ]);

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="page-title" className="m-0 [font:var(--text-page-title)]">
          가격정책 관리
        </h1>
        <CurrentApplyBadge current={current} />
      </div>
      <ImportPanel
        salesOptions={salesOptions}
        itemOptions={itemOptions}
        currentSalesId={current?.sales.id ?? null}
        currentItemId={current?.item?.id ?? null}
      />
      <RecentRuns runs={runs} />
      <PricingSection mode="admin" basePath="/admin/policies" searchParams={await searchParams} />
    </section>
  );
}

function CurrentApplyBadge({ current }: { current: CurrentApply | null }) {
  if (!current) return <Pill tone="neutral">현재 적용: 없음</Pill>;
  return (
    <Pill tone="positive" aria-label="현재 적용">
      현재 적용: 판매단가 {current.sales.fileName}({formatAuditTime(new Date(current.finishedAt))})
      · 품목상태 {current.item?.fileName ?? '없음'}
    </Pill>
  );
}

function RecentRuns({ runs }: { runs: readonly RecentRun[] }) {
  const failed = runs.filter((run) => run.status === 'failed').slice(0, 1);
  if (failed.length === 0) return null;
  return (
    <p className="m-0 text-[12px] text-text-tertiary">
      최근 실패한 적용: {formatAuditTime(new Date(failed[0]!.startedAt))} — {failed[0]!.error}
      (기존 데이터는 변경되지 않았습니다)
    </p>
  );
}
