import type { Metadata } from 'next';

import { getDb } from '@/db';
import { ViewStateTracker } from '@/features/page-state/ViewStateTracker';
import { PROCUREMENT_PAGES } from '@/features/procurement/copy';
import { PerformanceDashboard } from '@/features/procurement/performance/PerformanceDashboard';
import { YEARLY_SUMMARY_LIMIT } from '@/features/procurement/performance/model';
import { ProcurementHeader } from '@/features/procurement/ProcurementHeader';
import { formatDate } from '@/lib/date-format';
import {
  manufacturerOfKey,
  parsePerformanceView,
  resolvePerformanceView,
  todayMonth,
} from '@/lib/procurement/performance-filter';
import { restoreViewState } from '@/server/page-state/restore-page';
import { requireProcurementPage } from '@/server/procurement/access';
import { getCollectionStatus } from '@/server/procurement/collection';
import {
  MANUFACTURER_SERIES_TOP,
  getManufacturerPerformance,
  getMonthContracts,
  getMonthlyReport,
  getMonthlySeries,
  getMonthlySeriesByManufacturer,
  getMonthVolumes,
  getPerformanceKpis,
  getYearlyPerformance,
  type PerformanceScope,
} from '@/server/procurement/queries';

const PAGE = PROCUREMENT_PAGES.performance;

export const metadata: Metadata = { title: PAGE.title };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * 조달 실적 현황 (조달이 통합 UI-5, procurement.read — USER·ADMIN). URL 이 상태다(lib/procurement/performance-filter —
 * 탭·세부 그룹·기간·기준월·고른 달·계약 페이지·강조 제조사). 모든 금액·건수는 서버 집계(server/procurement/performance —
 * v_product_deliveries, 첫 변경차수 D-9)이고 브라우저에는 요약·한 페이지 계약만 내려간다.
 */
export default async function ProcurementPerformancePage({ searchParams }: PageProps) {
  const { user, access } = await requireProcurementPage('/procurement');
  const params = await searchParams;
  // 파라미터 없는 진입이면 저장된 조회 상태로 redirect (page-state-memory §2.2-4)
  const viewState = await restoreViewState('procurement', params, user);
  const view = parsePerformanceView(params);
  const scope: PerformanceScope = { product: view.tab, group: view.group };
  const db = await getDb();

  const [status, volumes] = await Promise.all([
    getCollectionStatus(access, db),
    getMonthVolumes(access, db, { scope }),
  ]);
  const resolved = resolvePerformanceView(view, volumes, todayMonth(formatDate(new Date())));
  const period = { from: resolved.from, to: resolved.to };
  const baseYear = Number(resolved.month.slice(0, 4));
  const filterName = manufacturerOfKey(view.mfr);

  const [kpis, manufacturers, chart, report, ourSeries, yearly, contracts] = await Promise.all([
    getPerformanceKpis(access, db, { scope, period }),
    getManufacturerPerformance(access, db, { scope, period }),
    getMonthlySeriesByManufacturer(access, db, { scope, period, topN: MANUFACTURER_SERIES_TOP }),
    getMonthlyReport(access, db, { scope, month: resolved.month }),
    // 보고표 "자사 조달 월별 매출": 전년 1월 ~ 올해 12월
    getMonthlySeries(access, db, {
      scope,
      period: { from: `${baseYear - 1}-01`, to: `${baseYear}-12` },
    }),
    // 요약(상위 4 + 기타) — 하나 더 받아 "기타 1개사" 줄을 피한다(원본 summarizeRows). 더보기는 모달이 전체를 가져온다
    getYearlyPerformance(access, db, { scope, manufacturerLimit: YEARLY_SUMMARY_LIMIT + 1 }),
    resolved.sel
      ? getMonthContracts(access, db, {
          scope,
          month: resolved.sel,
          ...(filterName !== null ? { manufacturer: filterName } : {}),
          page: resolved.page,
        })
      : Promise.resolve(null),
  ]);

  // 슬라이더 배경: 데이터 첫 달 ~ 선택지 끝(이번 달)까지, 빈 달 0
  const volumeByMonth = new Map(volumes.months.map((m) => [m.month, m.amount]));
  const volumeBars = resolved.months.map((month) => ({
    month,
    amount: volumeByMonth.get(month) ?? 0,
  }));
  const ourByMonth = ourSeries.map((point) => [point.month, point.ourAmount] as const);

  return (
    <section aria-labelledby="page-title" className="flex min-w-0 flex-col gap-4">
      <ProcurementHeader
        title={PAGE.title}
        collectedAt={status.daily.collectedAt}
        basis={PAGE.basis}
      />
      <PerformanceDashboard
        view={view}
        resolved={{
          from: resolved.from,
          to: resolved.to,
          month: resolved.month,
          sel: resolved.sel,
          months: resolved.months,
          presets: resolved.presets,
        }}
        hasData={volumes.first !== null}
        volumes={volumeBars}
        kpis={kpis}
        manufacturers={manufacturers}
        chart={chart}
        reportTotal={report.total}
        ourByMonth={ourByMonth}
        yearly={yearly}
        contracts={
          contracts && {
            rows: contracts.rows,
            total: contracts.total,
            page: contracts.page,
            pageCount: contracts.pageCount,
            amount: contracts.amount,
          }
        }
      />
      <ViewStateTracker {...viewState} />
    </section>
  );
}
