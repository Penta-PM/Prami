'use client';

import { useEffect, useId, useState } from 'react';

import { Button, Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { MonthKey } from '@/lib/month';
import type { IsignProductGroup, ProcurementProductTab } from '@/lib/procurement/constants';
import { formatMillionWon, formatShare, MILLION_WON_UNIT } from '@/lib/procurement/format';
import { ourTargetShare } from '@/lib/procurement/our-company';
import type { MonthlyReportRow } from '@/server/procurement/performance';

import { getManufacturerReportAction } from './actions';
import { TONE_TEXT } from './KpiCards';
import {
  buildOurMonthlyTable,
  buildReportSummary,
  manufacturerReportRows,
  OUR_COMPANY_LABEL,
} from './model';

export type MonthlyReportProps = {
  /** 범위 이름 (전체 · WAPPLES · iSIGN · SSO …) */
  label: string;
  tab: ProcurementProductTab;
  group: IsignProductGroup | null;
  baseMonth: MonthKey;
  /** 기준월 선택지 (오름차순 — 최근 달부터 보인다) */
  months: readonly MonthKey[];
  total: MonthlyReportRow;
  /** 전년 1월 ~ 올해 12월 자사 월 금액 */
  ourByMonth: readonly (readonly [MonthKey, number])[];
  onBaseMonthChange: (month: MonthKey) => void;
};

const TH =
  'border border-border-default bg-surface-muted px-1.5 py-1.5 text-center text-[13px] font-bold whitespace-nowrap text-text-primary';
const TD =
  'border border-border-default px-2 py-1.5 text-center text-[13px] whitespace-nowrap text-text-primary tabular-nums';
/** 기준월·누적 열 강조 (원본 RPT_FOCUS_BG — 자사 강조색 옅게) */
const FOCUS_BG = 'bg-accent-ours/[0.06]';
const FOCUS_HEAD = 'bg-accent-ours/[0.12]';

const yy = (year: number) => String(year).slice(2);
const monthOption = (month: MonthKey) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;

function signedMillion(value: number): string {
  const text = formatMillionWon(value);
  return Math.round(value / 100_000) > 0 ? `+${text}` : text;
}

function diffClass(value: number): string {
  const rounded = Math.round(value / 100_000);
  return rounded > 0 ? 'text-green-700' : rounded < 0 ? 'text-red-600' : 'text-text-secondary';
}

/**
 * 월 실적 보고표 (원본 MonthlyPerformanceReport — 보고서 양식): 제목 "{범위} {yy}년 조달 {M}월 실적" + 기준월 선택 +
 * "제조사별 실적표 ⤢"(모달), 요약 카드(기준월 실적·누적·누적 전년 동기 대비), "자사 조달 월별 매출" 표(전년·올해·증감).
 * 조회 기간과 별개로 기준월로 본다. 표 금액 = 백만원 소수 1자리(D-3, 단위는 머리에 한 번), 요약 = 억·만.
 */
export function MonthlyReport({
  label,
  tab,
  group,
  baseMonth,
  months,
  total,
  ourByMonth,
  onBaseMonthChange,
}: MonthlyReportProps) {
  const selectId = useId();
  const [modalOpen, setModalOpen] = useState(false);
  const year = Number(baseMonth.slice(0, 4));
  const mon = Number(baseMonth.slice(5, 7));
  const byMonth = new Map(ourByMonth);
  const summary = buildReportSummary(baseMonth, total, byMonth);
  const table = buildOurMonthlyTable(baseMonth, byMonth);
  const title = `${label} ${yy(year)}년 조달 ${mon}월 실적`;
  const options = months.includes(baseMonth) ? months : [...months, baseMonth].sort();

  return (
    <section
      aria-labelledby={`${selectId}-title`}
      data-testid="monthly-report"
      className="flex min-w-0 flex-col gap-3.5 rounded-2xl bg-surface-card px-4 py-5 shadow-(--hairline-default) sm:px-6"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id={`${selectId}-title`} className="m-0 text-[20px] font-bold text-text-primary">
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor={selectId} className="text-[14px] font-semibold text-text-secondary">
            기준월
          </label>
          <select
            id={selectId}
            value={baseMonth}
            onChange={(event) => onBaseMonthChange(event.target.value)}
            className="rounded-xl border-0 bg-gray-75 py-1.5 pr-7 pl-3 text-[14px] font-semibold text-ink-900 shadow-(--hairline-default) outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--purple-500)]"
          >
            {[...options].reverse().map((month) => (
              <option key={month} value={month}>
                {monthOption(month)}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" onClick={() => setModalOpen(true)}>
            제조사별 실적표 ⤢
          </Button>
        </div>
      </div>

      {/* 보고용 요약 — 기준월·누적 자사 실적과 점유율, 전년 같은 시점 대비 */}
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3" data-testid="report-summary">
        {summary.cards.map((card) => (
          <div
            key={card.label}
            className="flex min-w-0 flex-col rounded-2xl bg-surface-muted px-5 py-4 shadow-(--hairline-subtle)"
          >
            <div className="text-[14px] font-semibold text-text-secondary">{card.label}</div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="text-[24px] font-bold text-text-primary tabular-nums sm:text-[28px]">
                {card.value}
              </span>
              <span className="text-[15px] font-bold text-accent-ours">점유율 {card.share}</span>
            </div>
            <div className="mt-1.5 text-[13px] break-keep text-text-tertiary tabular-nums">
              {card.prevLabel} {card.prevValue} (점유율 {card.prevShare}) ·{' '}
              <span
                className={cn('font-bold', card.growth.tone ? TONE_TEXT[card.growth.tone] : '')}
              >
                {card.growth.text}
              </span>
            </div>
          </div>
        ))}
        <div
          className={cn(
            'flex min-w-0 flex-col justify-center rounded-2xl px-5 py-4 shadow-(--hairline-subtle)',
            summary.cumulative.tone === 'good'
              ? 'bg-green-600/10'
              : summary.cumulative.tone === 'bad'
                ? 'bg-red-500/10'
                : 'bg-surface-muted',
          )}
        >
          <div className="text-[14px] font-semibold text-text-secondary">누적 전년 동기 대비</div>
          <div
            className={cn(
              'mt-1.5 text-[28px] font-bold tabular-nums',
              summary.cumulative.tone ? TONE_TEXT[summary.cumulative.tone] : 'text-text-tertiary',
            )}
          >
            {summary.cumulative.text}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[16px] font-bold text-text-primary">
          {OUR_COMPANY_LABEL} 조달 월별 매출
        </h3>
        <span className="text-[13px] text-text-tertiary">(단위: {MILLION_WON_UNIT}/월)</span>
      </div>
      <div className="w-full min-w-0 overflow-x-auto">
        <table
          aria-label={`${OUR_COMPANY_LABEL} 조달 월별 매출 (단위: ${MILLION_WON_UNIT})`}
          className="w-full border-collapse"
          data-testid="our-monthly-table"
        >
          <thead>
            <tr>
              <th scope="col" className={TH}>
                구분
              </th>
              <th scope="col" className={TH}>
                연도
              </th>
              {table.before.map((m) => (
                <th
                  key={m}
                  scope="col"
                  className={cn(TH, m === table.baseMonthNumber && FOCUS_HEAD)}
                >
                  {m}월
                </th>
              ))}
              <th scope="col" className={cn(TH, FOCUS_HEAD)}>
                누적
              </th>
              {table.after.map((m) => (
                <th key={m} scope="col" className={TH}>
                  {m}월
                </th>
              ))}
              <th scope="col" className={TH}>
                총 합계
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={row.year}>
                {index === 0 && (
                  <th
                    scope="row"
                    rowSpan={3}
                    className={cn(TD, 'w-[110px] text-[14px] font-bold whitespace-normal')}
                  >
                    {label}
                  </th>
                )}
                <th scope="row" className={cn(TD, 'font-bold')}>
                  {row.year}
                </th>
                {row.before.map((amount, i) => (
                  <td
                    key={table.before[i]}
                    className={cn(TD, table.before[i] === table.baseMonthNumber && FOCUS_BG)}
                  >
                    {formatMillionWon(amount)}
                  </td>
                ))}
                <td className={cn(TD, FOCUS_BG, 'font-bold')}>{formatMillionWon(row.ytd)}</td>
                {row.after.map((amount, i) => (
                  <td key={table.after[i]} className={cn(TD, 'text-text-secondary')}>
                    {amount === null ? '' : formatMillionWon(amount)}
                  </td>
                ))}
                <td className={cn(TD, 'font-bold')}>
                  {row.full === null ? '' : formatMillionWon(row.full)}
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className={cn(TD, 'bg-surface-muted font-bold')}>
                증감
              </th>
              {table.diff.before.map((diff, i) => (
                <td
                  key={table.before[i]}
                  className={cn(
                    TD,
                    'font-bold',
                    table.before[i] === table.baseMonthNumber ? FOCUS_BG : 'bg-surface-muted',
                    diffClass(diff),
                  )}
                >
                  {signedMillion(diff)}
                </td>
              ))}
              <td className={cn(TD, FOCUS_BG, 'font-bold', diffClass(table.diff.ytd))}>
                {signedMillion(table.diff.ytd)}
              </td>
              {table.after.map((m) => (
                <td key={m} className={cn(TD, 'bg-surface-muted')} />
              ))}
              <td className={cn(TD, 'bg-surface-muted')} />
            </tr>
          </tbody>
        </table>
      </div>

      <ManufacturerReportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        label={label}
        tab={tab}
        group={group}
        baseMonth={baseMonth}
      />
    </section>
  );
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: MonthlyReportRow[] };

/**
 * 제조사별 실적표 (원본 모달 — 페이지에서 빼고 창으로만 본다): 구분 · {M}월(수주 건수·금액·점유율) · {M}월 누적(같은 셋) ·
 * {전년}년 점유율(년기준) · {올해}년 목표 점유율. 자사 먼저, 경쟁사 상위 6 + 기타(N개), 소계. 열 때 서버에서 가져온다.
 */
function ManufacturerReportModal({
  open,
  onClose,
  label,
  tab,
  group,
  baseMonth,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  tab: ProcurementProductTab;
  group: IsignProductGroup | null;
  baseMonth: MonthKey;
}) {
  const requestKey = `${tab}|${group ?? ''}|${baseMonth}`;
  const [loaded, setLoaded] = useState<{ key: string; state: LoadState } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getManufacturerReportAction({ tab, group, month: baseMonth }).then(
      (result) => {
        if (cancelled) return;
        setLoaded({
          key: requestKey,
          state: result.ok
            ? { status: 'ready', rows: result.data }
            : { status: 'error', message: result.error.message },
        });
      },
      () => {
        if (!cancelled)
          setLoaded({
            key: requestKey,
            state: { status: 'error', message: '제조사별 실적을 불러오지 못했습니다' },
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, tab, group, baseMonth, requestKey, attempt]);

  const state: LoadState =
    loaded && loaded.key === requestKey ? loaded.state : { status: 'loading' };
  const year = Number(baseMonth.slice(0, 4));
  const mon = Number(baseMonth.slice(5, 7));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`${label} ${yy(year)}년 ${mon}월 제조사별 실적 (단위: ${MILLION_WON_UNIT})`}
    >
      {state.status === 'loading' ? (
        <p role="status" className="m-0 py-8 text-center text-[13px] text-text-tertiary">
          불러오는 중…
        </p>
      ) : state.status === 'error' ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="m-0 text-[13px] text-red-600">{state.message}</p>
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
        <ManufacturerReportTable
          label={label}
          year={year}
          mon={mon}
          rows={state.rows}
          targetShare={ourTargetShare(tab, year)}
        />
      )}
    </Modal>
  );
}

const pct = (value: number, total: number) =>
  total > 0 ? formatShare(value / total) : formatShare(null);

/** 제조사별 실적표 본문 — 원본 열 구성 그대로 (테스트용으로 export) */
export function ManufacturerReportTable({
  label,
  year,
  mon,
  rows: source,
  targetShare = null,
}: {
  label: string;
  year: number;
  mon: number;
  rows: readonly MonthlyReportRow[];
  /** 자사 목표 점유율 (0~1) — 설정 값이 없으면 "—" */
  targetShare?: number | null;
}) {
  const { rows, totals } = manufacturerReportRows(source);
  const count = (value: number) => value.toLocaleString('ko-KR');
  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <table
        aria-label={`${label} ${yy(year)}년 ${mon}월 제조사별 실적 (단위: ${MILLION_WON_UNIT})`}
        className="w-full border-collapse"
        data-testid="manufacturer-report-table"
      >
        <thead>
          <tr>
            <th scope="col" rowSpan={2} colSpan={2} className={TH}>
              구분
            </th>
            <th scope="colgroup" colSpan={3} className={cn(TH, FOCUS_HEAD)}>
              {mon}월
            </th>
            <th scope="colgroup" colSpan={3} className={cn(TH, FOCUS_HEAD)}>
              {mon}월 누적
            </th>
            <th scope="col" rowSpan={2} className={TH}>
              {year - 1}년
              <br />
              점유율(년기준)
            </th>
            <th scope="col" rowSpan={2} className={TH}>
              {year}년
              <br />
              목표 점유율
            </th>
          </tr>
          <tr>
            {['수주 건수', '금액', '점유율', '수주 건수', '금액', '점유율'].map((column, index) => (
              <th key={index} scope="col" className={TH}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const cell = cn(TD, row.isOurs && 'bg-accent-ours/[0.08] font-bold');
            return (
              <tr key={row.key} data-report-row={row.key}>
                {index === 0 && (
                  <th
                    scope="rowgroup"
                    rowSpan={rows.length + 1}
                    className={cn(TD, 'w-[110px] text-[14px] font-bold whitespace-normal')}
                  >
                    {label}
                  </th>
                )}
                <th
                  scope="row"
                  title={row.title}
                  className={cn(
                    cell,
                    row.isOurs
                      ? 'text-accent-ours'
                      : row.isEtc
                        ? 'text-text-secondary'
                        : 'text-text-primary',
                  )}
                >
                  {row.label}
                </th>
                <td className={cell}>{count(row.monthContractCount)}</td>
                <td className={cell}>{formatMillionWon(row.monthAmount)}</td>
                <td className={cell}>{pct(row.monthAmount, totals.monthAmount)}</td>
                <td className={cell}>{count(row.ytdContractCount)}</td>
                <td className={cell}>{formatMillionWon(row.ytdAmount)}</td>
                <td className={cell}>{pct(row.ytdAmount, totals.ytdAmount)}</td>
                <td className={cell}>{pct(row.previousYearAmount, totals.previousYearAmount)}</td>
                <td className={cell}>{row.isOurs ? formatShare(targetShare) : ''}</td>
              </tr>
            );
          })}
          <tr data-report-row="subtotal">
            {[
              '소계',
              count(totals.monthContractCount),
              formatMillionWon(totals.monthAmount),
              totals.monthAmount > 0 ? '100%' : formatShare(null),
              count(totals.ytdContractCount),
              formatMillionWon(totals.ytdAmount),
              totals.ytdAmount > 0 ? '100%' : formatShare(null),
              totals.previousYearAmount > 0 ? '100%' : formatShare(null),
              '',
            ].map((value, index) =>
              index === 0 ? (
                <th key={index} scope="row" className={cn(TD, 'bg-surface-muted font-bold')}>
                  {value}
                </th>
              ) : (
                <td key={index} className={cn(TD, 'bg-surface-muted font-bold')}>
                  {value}
                </td>
              ),
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
