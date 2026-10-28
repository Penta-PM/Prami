'use client';

import { useEffect, useState } from 'react';

import { Button, Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { IsignProductGroup, ProcurementProductTab } from '@/lib/procurement/constants';
import { formatMillionWon, formatShare, MILLION_WON_UNIT } from '@/lib/procurement/format';
import type { YearlyPerformance } from '@/server/procurement/performance';

import { getYearlyPerformanceAllAction } from './actions';
import { YEARLY_SUMMARY_LIMIT, yearlyTableRows, type YearlyTableRow } from './model';

type PanelKey = 'amount' | 'share';

const PANELS: { key: PanelKey; title: string }[] = [
  { key: 'amount', title: '연도별 매출액 비교' },
  { key: 'share', title: '연도별 점유율 현황' },
];

const TH =
  'border-b border-border-default px-2 py-1.5 text-[14px] font-bold whitespace-nowrap text-text-secondary';
const TD = 'px-2 py-1.5 text-right text-[14px] whitespace-nowrap text-text-primary tabular-nums';
const TOTAL = 'border-t-2 border-border-default font-bold';

/**
 * 상세 분석 · 전체 기간 (원본 — 조회 기간과 무관): "연도별 매출액 비교"(YearlyAmountMatrix) · "연도별 점유율 현황"(YearlyShareMatrix).
 * 평소엔 상위 4개사(자사 포함) + 기타로 요약하고, "더보기 ›" 로 전체 표를 모달로 띄운다(열 때 서버에서 전체를 가져온다).
 * 표 금액 = 백만원(D-3), 점유율 = 그 해 합계 대비.
 */
export function YearlySection({
  yearly,
  tab,
  group,
}: {
  /** manufacturerLimit = 요약 줄 수 + 1 로 가져온 연도별 실적 */
  yearly: YearlyPerformance;
  tab: ProcurementProductTab;
  group: IsignProductGroup | null;
}) {
  const [opened, setOpened] = useState<PanelKey | null>(null);
  const panel = PANELS.find((item) => item.key === opened) ?? null;
  return (
    <section aria-labelledby="yearly-section-title" className="flex min-w-0 flex-col gap-3">
      <h2
        id="yearly-section-title"
        className="m-0 mt-1 text-[14px] font-semibold tracking-[0.4px] text-text-tertiary"
      >
        상세 분석 · 전체 기간 (조회 기간과 무관)
      </h2>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        {PANELS.map((item) => (
          <div
            key={item.key}
            data-yearly-panel={item.key}
            className="flex min-w-0 flex-col gap-3 rounded-2xl bg-surface-card p-4 shadow-(--hairline-default) sm:p-6"
          >
            <div className="flex items-baseline justify-between gap-2.5">
              <h3 className="m-0 text-[16px] font-semibold text-text-primary">{item.title}</h3>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`${item.title} 더보기`}
                onClick={() => setOpened(item.key)}
                className="border-0 bg-transparent text-[14px] font-semibold whitespace-nowrap text-text-tertiary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                더보기 ›
              </button>
            </div>
            <YearlyTable
              kind={item.key}
              title={item.title}
              years={yearly.years}
              totals={yearly.totals.map((total) => total.amount)}
              rows={yearlyTableRows(yearly, YEARLY_SUMMARY_LIMIT)}
            />
          </div>
        ))}
      </div>
      <YearlyModal panel={panel} onClose={() => setOpened(null)} tab={tab} group={group} />
    </section>
  );
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: YearlyPerformance };

function YearlyModal({
  panel,
  onClose,
  tab,
  group,
}: {
  panel: { key: PanelKey; title: string } | null;
  onClose: () => void;
  tab: ProcurementProductTab;
  group: IsignProductGroup | null;
}) {
  const open = panel !== null;
  const requestKey = `${tab}|${group ?? ''}`;
  const [loaded, setLoaded] = useState<{ key: string; state: LoadState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cached = loaded?.key === requestKey && loaded.state.status === 'ready';

  useEffect(() => {
    if (!open || cached) return;
    let cancelled = false;
    void getYearlyPerformanceAllAction({ tab, group }).then(
      (result) => {
        if (cancelled) return;
        setLoaded({
          key: requestKey,
          state: result.ok
            ? { status: 'ready', data: result.data }
            : { status: 'error', message: result.error.message },
        });
      },
      () => {
        if (!cancelled)
          setLoaded({
            key: requestKey,
            state: { status: 'error', message: '연도별 실적을 불러오지 못했습니다' },
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, cached, tab, group, requestKey, attempt]);

  const state: LoadState =
    loaded && loaded.key === requestKey ? loaded.state : { status: 'loading' };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={panel?.title ?? ''}>
      {!panel ? null : state.status === 'loading' ? (
        <p role="status" className="m-0 py-8 text-center text-[14px] text-text-tertiary">
          불러오는 중…
        </p>
      ) : state.status === 'error' ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="m-0 text-[14px] text-text-danger">{state.message}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setLoaded(null);
              setAttempt((value) => value + 1);
            }}
          >
            다시 시도
          </Button>
        </div>
      ) : (
        <YearlyTable
          kind={panel.key}
          title={panel.title}
          years={state.data.years}
          totals={state.data.totals.map((total) => total.amount)}
          rows={yearlyTableRows(state.data, null)}
        />
      )}
    </Modal>
  );
}

/** 연도별 표 — 매출액(백만원) 또는 점유율. 열 = 제조사 · 연도… · 합계, 끝에 합계 행 (원본 열 구성) */
export function YearlyTable({
  kind,
  title,
  years,
  totals,
  rows,
}: {
  kind: PanelKey;
  title: string;
  years: readonly number[];
  /** years 와 같은 순서의 연도 합계 */
  totals: readonly number[];
  rows: readonly YearlyTableRow[];
}) {
  const grand = totals.reduce((sum, value) => sum + value, 0);
  const cell = (amount: number, total: number) =>
    kind === 'amount'
      ? amount > 0
        ? formatMillionWon(amount)
        : '-'
      : total > 0
        ? formatShare(amount / total)
        : '-';
  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <table
        aria-label={kind === 'amount' ? `${title} (단위: ${MILLION_WON_UNIT})` : title}
        data-yearly-table={kind}
        className="w-full border-collapse"
      >
        {kind === 'amount' && (
          <caption className="pb-1 text-right text-[12px] text-text-tertiary">
            (단위: {MILLION_WON_UNIT})
          </caption>
        )}
        <thead>
          <tr>
            <th scope="col" className={cn(TH, 'text-left')}>
              제조사
            </th>
            {years.map((year) => (
              <th key={year} scope="col" className={cn(TH, 'text-right')}>
                {year}
              </th>
            ))}
            <th scope="col" className={cn(TH, 'text-right')}>
              합계
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={years.length + 2}
                className="px-2 py-2.5 text-center text-[14px] text-text-tertiary"
              >
                실적 없음
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.key}
                data-yearly-row={row.key}
                className={row.isOurs ? 'bg-accent-ours/[0.08]' : undefined}
              >
                <th
                  scope="row"
                  title={row.title}
                  className={cn(
                    'max-w-[140px] truncate px-2 py-1.5 text-left text-[14px]',
                    row.isOurs
                      ? 'font-bold text-accent-ours'
                      : row.isEtc
                        ? 'font-medium text-text-secondary'
                        : 'font-medium text-text-primary',
                  )}
                >
                  {row.label}
                </th>
                {years.map((year, index) => (
                  <td key={year} className={TD}>
                    {cell(row.amounts[index] ?? 0, totals[index] ?? 0)}
                  </td>
                ))}
                <td className={cn(TD, 'font-bold')}>
                  {kind === 'amount'
                    ? formatMillionWon(row.total)
                    : grand > 0
                      ? formatShare(row.total / grand)
                      : '-'}
                </td>
              </tr>
            ))
          )}
          {rows.length > 0 && (
            <tr>
              <th scope="row" className={cn(TOTAL, 'px-2 py-1.5 text-left text-[14px]')}>
                합계
              </th>
              {years.map((year, index) => (
                <td key={year} className={cn(TD, TOTAL)}>
                  {kind === 'amount' ? formatMillionWon(totals[index] ?? 0) : '100%'}
                </td>
              ))}
              <td className={cn(TD, TOTAL)}>
                {kind === 'amount' ? formatMillionWon(grand) : '100%'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
