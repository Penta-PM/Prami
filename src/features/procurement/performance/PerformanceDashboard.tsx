'use client';

import { useMemo, useState } from 'react';

import { Card } from '@/components/ui';
import type { MonthVolumeBar } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { MonthKey } from '@/lib/month';
import {
  manufacturerOfKey,
  performanceHref,
  type PerformanceView,
  type PeriodPreset,
} from '@/lib/procurement/performance-filter';
import type {
  ManufacturerPerformance,
  MonthlyReportRow,
  MonthlySeriesByManufacturer,
  PerformanceKpis,
  YearlyPerformance,
} from '@/server/procurement/performance';

import { ComboChart } from '../charts';
import { ContractList, type ContractListData } from './ContractList';
import { KpiCards } from './KpiCards';
import { ManufacturerTable } from './ManufacturerTable';
import {
  buildKpiCards,
  chartHighlightKey,
  comboSeriesOf,
  displayName,
  manufacturerTableRows,
} from './model';
import { MonthlyReport } from './MonthlyReport';
import { PeriodFilter } from './PeriodFilter';
import { ProductTabs, scopeLabel } from './ProductTabs';
import { usePerformanceNav } from './use-performance-nav';
import { YearlySection } from './YearlySection';

export type PerformanceDashboardProps = {
  /** URL 상태 (파싱 그대로 — 다음 주소 계산의 기준) */
  view: PerformanceView;
  /** 데이터 범위에 맞춘 값 */
  resolved: {
    from: MonthKey;
    to: MonthKey;
    month: MonthKey;
    sel: MonthKey | null;
    months: readonly MonthKey[];
    presets: readonly PeriodPreset[];
  };
  /** 이 범위(탭·그룹)에 실적이 하나라도 있는가 */
  hasData: boolean;
  volumes: readonly MonthVolumeBar[];
  kpis: PerformanceKpis;
  manufacturers: ManufacturerPerformance;
  chart: MonthlySeriesByManufacturer;
  reportTotal: MonthlyReportRow;
  ourByMonth: readonly (readonly [MonthKey, number])[];
  yearly: YearlyPerformance;
  contracts: ContractListData | null;
};

/** 낙관적 표시 — 요청한 값을 URL 이 따라올 때까지 보이고, URL 이 (다른 값으로) 바뀌면 URL 값을 따른다 */
function useOptimistic<T>(urlValue: T): [T, (next: T) => void] {
  const [pending, setPending] = useState<{ base: T; value: T } | null>(null);
  const shown = pending && Object.is(pending.base, urlValue) ? pending.value : urlValue;
  return [shown, (next: T) => setPending({ base: urlValue, value: next })];
}

/**
 * 조달 실적 현황 (조달이 통합 UI-5) — 조달이 원본 CompetitorComparePanel + CompetitorLineChart 의 구성 순서:
 * 제품 탭(+ iSIGN 세부 그룹) → 월 실적 보고표(기준월) → 조회 기간(프리셋 + 월 슬라이더) → KPI(HeroStat) →
 * [월별 매출 추이 콤보 차트 ↔ 제조사별 실적 표] (+ 고른 달 계약 목록) → 상세 분석(연도별 매출액·점유율, 더보기).
 * 모든 수치는 서버 집계(props) — 조작은 URL 을 바꾸고 서버 page 가 다시 집계한다.
 */
export function PerformanceDashboard(props: PerformanceDashboardProps) {
  const { view } = props;
  const { navigate, isPending } = usePerformanceNav(view);
  const label = scopeLabel(view.tab, view.group);

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-4 transition-opacity motion-reduce:transition-none',
        isPending && 'opacity-70',
      )}
      aria-busy={isPending || undefined}
      data-testid="procurement-performance"
    >
      <ProductTabs
        tab={view.tab}
        group={view.group}
        onTabChange={(tab) =>
          navigate({ tab, group: null, month: null, sel: null, page: 1, mfr: null })
        }
        onGroupChange={(group) => {
          if (group === view.group) return;
          navigate({ group, month: null, sel: null, page: 1, mfr: null });
        }}
      />
      {props.hasData ? (
        <PerformanceBody {...props} label={label} navigate={navigate} />
      ) : (
        <Card role="status" className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="m-0 text-[16px] font-semibold text-text-primary">
            {label} 조달 실적이 없습니다
          </p>
          <p className="m-0 text-[14px] break-keep text-text-tertiary">
            수집된 납품요구 실적이 생기면 월 실적 보고표·월별 추이·연도별 표를 보여 줍니다.
          </p>
        </Card>
      )}
    </div>
  );
}

function PerformanceBody({
  view,
  resolved,
  volumes,
  kpis,
  manufacturers,
  chart,
  reportTotal,
  ourByMonth,
  yearly,
  contracts,
  label,
  navigate,
}: PerformanceDashboardProps & {
  label: string;
  navigate: (patch: Partial<PerformanceView>) => void;
}) {
  const [highlight, setHighlight] = useOptimistic(view.mfr);
  const [selected, setSelected] = useOptimistic(resolved.sel);
  const series = useMemo(() => comboSeriesOf(chart), [chart]);
  const chartKeys = useMemo(() => new Set(series.map((item) => item.key)), [series]);
  const tableRows = useMemo(() => manufacturerTableRows(manufacturers), [manufacturers]);
  const kpiCards = useMemo(() => buildKpiCards(kpis, manufacturers), [kpis, manufacturers]);

  const changeHighlight = (next: string | null) => {
    setHighlight(next);
    navigate({ mfr: next, page: 1 });
  };
  const selectMonth = (month: MonthKey | null) => {
    setSelected(month);
    navigate({ sel: month, page: 1 });
  };
  const filterName = manufacturerOfKey(view.mfr);

  return (
    <>
      {/* 보고서 양식의 월 실적표 — 핵심 수치라 맨 위 (조회 기간과 별개로 기준월로 본다, 원본) */}
      <MonthlyReport
        label={label}
        tab={view.tab}
        group={view.group}
        baseMonth={resolved.month}
        months={resolved.months}
        total={reportTotal}
        ourByMonth={ourByMonth}
        onBaseMonthChange={(month) => navigate({ month })}
      />

      <PeriodFilter
        value={{ from: resolved.from, to: resolved.to }}
        months={resolved.months}
        presets={resolved.presets}
        volumes={volumes}
        onChange={(period) => navigate({ ...period, sel: null, page: 1 })}
      />

      <KpiCards cards={kpiCards} />

      {/* 월별·누적 매출 콤보 차트(좌) ↔ 제조사별 실적 표(우) — 표 행·범례로 같은 제조사를 강조한다 (원본 jd-split) */}
      <section
        aria-label="월별 매출 추이와 제조사별 실적"
        className="grid min-w-0 grid-cols-1 gap-6 rounded-2xl bg-surface-card px-4 py-5 shadow-(--hairline-default) sm:px-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="m-0 text-text-primary [font:var(--text-h2)]">월별 매출 추이</h2>
          <ComboChart
            title={`${label} 월별 매출 추이`}
            months={chart.months}
            series={series}
            highlightKey={chartHighlightKey(highlight, chartKeys)}
            onHighlightChange={(key) => changeHighlight(key)}
            selectedMonth={selected}
            onSelectMonth={selectMonth}
            activateHint="클릭하면 계약 목록"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2 lg:border-l lg:border-border-subtle lg:pl-6">
          <h2 className="m-0 text-text-primary [font:var(--text-h2)]">제조사별 실적</h2>
          <ManufacturerTable
            rows={tableRows}
            total={manufacturers.total.amount}
            highlight={highlight}
            chartKeys={chartKeys}
            onToggleHighlight={(key) => changeHighlight(highlight === key ? null : key)}
          />
        </div>
        {/* 계약 목록 — 차트 칸에 갇히지 않게 두 칸을 가로질러 (원본) */}
        {resolved.sel && contracts && (
          <div className="min-w-0 lg:col-span-2">
            <ContractList
              month={resolved.sel}
              manufacturerLabel={filterName === null ? null : displayName(filterName)}
              data={contracts}
              onClose={() => selectMonth(null)}
              pageHref={(page) => performanceHref({ ...view, page })}
            />
          </div>
        )}
      </section>

      <YearlySection yearly={yearly} tab={view.tab} group={view.group} />
    </>
  );
}
