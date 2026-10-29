'use client';

import { useMemo, useRef, useState } from 'react';

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import {
  EMPTY_VALUE,
  formatEokMan,
  formatMillionWon,
  MILLION_WON_UNIT,
} from '@/lib/procurement/format';

import { ChartFrame, ChartPlot, ChartTooltip, type TooltipRow } from './ChartFrame';
import { ChartLegend, type LegendItem } from './ChartLegend';
import { Marker } from './Marker';
import { LATEST_YEAR_TOKEN, seriesColor, seriesMarker } from './palette';
import { buildYearLines, linearScale, niceTicks, yearlySummary, type YearlyPoint } from './scale';
import { useControllable, useHiddenKeys } from './use-controllable';
import { useElementWidth } from './use-element-width';

export type YearlyLineChartProps = {
  title: string;
  /** 월 금액(원) — 여러 해에 걸쳐. 실적 없는 달은 amount 0 으로 넣어야 선이 이어진다(없는 달은 선이 끊긴다) */
  points: readonly YearlyPoint[];
  /** cumulative(기본, 조달이 원본) = 연초부터 누적 / monthly = 월 금액 */
  mode?: 'cumulative' | 'monthly';
  highlightYear?: string | null;
  onHighlightYearChange?: (year: string | null) => void;
  showTitle?: boolean;
  className?: string;
};

const MONTH_TICKS = [1, 3, 5, 7, 9, 11];

/** 너비(px) → 그리기 치수. W 는 잰 실수 너비 그대로(viewBox 배율 1 — 화소 격자 유지), 높이는 정수 */
export function yearlyDims(width: number) {
  const W = Math.max(280, width);
  const H = Math.round(Math.min(340, Math.max(220, W * 0.45)));
  const pad = W < 480 ? { l: 54, r: 40, t: 16, b: 28 } : { l: 72, r: 48, t: 20, b: 30 };
  return { W, H, pad, IW: W - pad.l - pad.r, IH: H - pad.t - pad.b, BASE: H - pad.b };
}

type Segment = { dashed: boolean; points: { x: number; y: number }[] };

/**
 * 이어지는 점들을 같은 모양(실선/점선)끼리 묶은 구간 — 구간마다 path 하나(꺾임점 틈·점선 재시작 방지).
 * 그달 금액이 0 이면 그 달로 들어오는 선분은 점선. 빈 달(null)에서 선이 끊긴다.
 */
function segmentsOf<P extends { amount: number }>(
  points: readonly (P | null)[],
  at: (point: P) => { x: number; y: number },
): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const point = points[index];
    if (!point || !previous) {
      current = null;
      continue;
    }
    const dashed = !(point.amount > 0);
    if (!current || current.dashed !== dashed) {
      current = { dashed, points: [at(previous)] };
      segments.push(current);
    }
    current.points.push(at(point));
  }
  return segments;
}

/**
 * 연도별 선 차트 (조달이 YearlyTrendChart 이식): x = 1~12월, 연도마다 선 하나. 최근 연도는 진한 중립색(Neutral 900),
 * 과거 연도는 최근부터 계열색. 실적 없는 달(누적이 평평)은 점선. 선 끝에 연도 글자(색 외 구분) + 연도별 표식 모양.
 */
export function YearlyLineChart({
  title,
  points,
  mode = 'cumulative',
  highlightYear: highlightProp,
  onHighlightYearChange,
  showTitle,
  className,
}: YearlyLineChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const d = yearlyDims(useElementWidth(boxRef, 640));
  const [highlightYear, setHighlightYear] = useControllable<string | null>(
    highlightProp,
    onHighlightYearChange,
    null,
  );
  const [hiddenKeys, toggleHidden] = useHiddenKeys();
  const [active, setActive] = useState<number | null>(null);

  const lines = useMemo(() => {
    const built = buildYearLines(points);
    return built.map((line, index) => {
      const latest = index === built.length - 1;
      const rank = built.length - 2 - index;
      return {
        ...line,
        latest,
        color: latest ? `var(${LATEST_YEAR_TOKEN})` : seriesColor(rank),
        marker: seriesMarker(rank, latest),
      };
    });
  }, [points]);
  const visible = lines.filter((line) => !hiddenKeys.has(line.year));
  const valueOf = (point: { amount: number; cumulative: number }) =>
    mode === 'cumulative' ? point.cumulative : point.amount;
  const summary = yearlySummary(title, lines);

  const ticks = niceTicks(
    Math.max(0, ...visible.flatMap((line) => line.points.map((p) => (p ? valueOf(p) : 0)))),
  );
  const y = linearScale(ticks.at(-1)!, d.BASE, d.pad.t);
  const xOf = (month: number) => d.pad.l + ((month - 1) / 11) * d.IW;
  const indexAt = (x: number) => Math.min(11, Math.max(0, Math.round(((x - d.pad.l) / d.IW) * 11)));
  const dimmed = (year: string) => highlightYear !== null && highlightYear !== year;

  const legendItems: LegendItem[] = [...lines].reverse().map((line) => ({
    key: line.year,
    label: `${line.year}년`,
    color: line.color,
    marker: line.marker,
  }));

  const rowsAt = (index: number) =>
    [...visible].reverse().map((line) => ({ line, point: line.points[index] ?? null }));

  const pointText = (index: number) =>
    `${index + 1}월: ` +
    rowsAt(index)
      .map(({ line, point }) =>
        point
          ? `${line.year}년 월 ${formatEokMan(point.amount)}, 누적 ${formatEokMan(point.cumulative)}`
          : `${line.year}년 자료 없음`,
      )
      .join('. ');

  const tooltip = (index: number) => {
    const rows: TooltipRow[] = rowsAt(index).map(({ line, point }) => ({
      key: line.year,
      label: `${line.year}년`,
      color: line.color,
      marker: line.marker,
      values: point
        ? [formatEokMan(point.amount), formatEokMan(point.cumulative)]
        : [EMPTY_VALUE, EMPTY_VALUE],
    }));
    return (
      <ChartTooltip
        x={xOf(index + 1)}
        width={d.W}
        title={`${index + 1}월`}
        columns={['월 금액', '연초부터 누적']}
        rows={rows}
      />
    );
  };

  return (
    <ChartFrame
      title={title}
      summary={summary}
      showTitle={showTitle}
      className={className}
      note={
        mode === 'cumulative'
          ? '연초부터 누적 금액 · 점선 = 그달 실적 없음'
          : '월 금액 · 점선 = 그달 실적 없음'
      }
      legend={
        <ChartLegend
          items={legendItems}
          highlightKey={highlightYear}
          onHighlightChange={setHighlightYear}
          hiddenKeys={hiddenKeys}
          onToggleHidden={toggleHidden}
          aria-label={`${title} 범례`}
        />
      }
      table={<YearlyTable title={title} lines={lines} mode={mode} />}
    >
      <div ref={boxRef} className="w-full min-w-0">
        {lines.length === 0 ? (
          <p className="m-0 py-10 text-center text-[14px] text-text-tertiary">
            표시할 데이터가 없습니다
          </p>
        ) : (
          <ChartPlot
            title={title}
            count={12}
            active={active}
            onActiveChange={setActive}
            pointText={pointText}
            indexAt={indexAt}
          >
            <svg
              role="img"
              aria-label={summary}
              viewBox={`0 0 ${d.W} ${d.H}`}
              width="100%"
              height={d.H}
              className="block overflow-visible"
              data-yearly-chart=""
            >
              {ticks.map((tick) => (
                <g key={tick}>
                  {/* 1px 격자 = 정수 + 0.5 에 그려 화소 한 줄에 맞춘다 */}
                  <line
                    data-grid=""
                    x1={d.pad.l}
                    x2={Math.round(d.W - d.pad.r)}
                    y1={Math.round(y(tick)) + 0.5}
                    y2={Math.round(y(tick)) + 0.5}
                    stroke="var(--border-default)"
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={d.pad.l - 8}
                    y={y(tick) + 4}
                    textAnchor="end"
                    fontSize={12}
                    fill="var(--text-secondary)"
                  >
                    {formatEokMan(tick)}
                  </text>
                </g>
              ))}
              {MONTH_TICKS.map((month) => (
                <text
                  key={month}
                  x={xOf(month)}
                  y={d.H - d.pad.b + 18}
                  textAnchor="middle"
                  fontSize={12}
                  fill="var(--text-secondary)"
                >
                  {month}월
                </text>
              ))}
              {active !== null && (
                <line
                  data-active-month={active + 1}
                  x1={xOf(active + 1)}
                  x2={xOf(active + 1)}
                  y1={d.pad.t}
                  y2={d.BASE}
                  stroke="var(--focus-ring)"
                  strokeWidth={2}
                />
              )}
              {visible.map((line) => {
                const emphasized = highlightYear === line.year;
                const last = [...line.points].reverse().find((point) => point !== null);
                return (
                  <g
                    key={line.year}
                    data-line={line.year}
                    opacity={dimmed(line.year) ? 0.15 : 1}
                    className="transition-opacity duration-150 motion-reduce:transition-none"
                  >
                    {segmentsOf(line.points, (point) => ({
                      x: xOf(point.month),
                      y: y(valueOf(point)),
                    })).map((segment, index) => (
                      <path
                        key={index}
                        data-segment={segment.dashed ? 'dashed' : 'solid'}
                        d={segment.points
                          .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
                          .join(' ')}
                        fill="none"
                        stroke={line.color}
                        strokeWidth={emphasized || line.latest ? 3 : 2}
                        strokeDasharray={segment.dashed ? '4 3' : undefined}
                        // 점선은 둥근 끝이 대시마다 붙어 틈(3)을 메우므로 기본(butt) 끝 — 실선 끝의 둥근 마개가 이음매를 덮는다
                        strokeLinecap={segment.dashed ? undefined : 'round'}
                        strokeLinejoin="round"
                      />
                    ))}
                    {line.points.map((point, index) =>
                      point ? (
                        <Marker
                          key={index}
                          shape={line.marker}
                          x={xOf(point.month)}
                          y={y(valueOf(point))}
                          r={index === active ? 5 : 3.5}
                          color={line.color}
                        />
                      ) : null,
                    )}
                    {last && (
                      <text
                        x={xOf(last.month) + 8}
                        y={y(valueOf(last)) + 4}
                        fontSize={11}
                        fontWeight={line.latest ? 700 : 500}
                        fill={line.color}
                      >
                        {line.year.slice(2)}년
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {active !== null && tooltip(active)}
          </ChartPlot>
        )}
      </div>
    </ChartFrame>
  );
}

/** 표로 보기 — 행 = 1~12월, 열 = 연도(최근 먼저). 값 = 차트와 같은 값(누적/월), 백만원 */
function YearlyTable({
  title,
  lines,
  mode,
}: {
  title: string;
  lines: ReturnType<typeof buildYearLines>;
  mode: 'cumulative' | 'monthly';
}) {
  const ordered = [...lines].reverse();
  return (
    <Table className="tabular-nums">
      <caption className="pb-2 text-left text-[12px] text-text-tertiary">
        {title} — {mode === 'cumulative' ? '연초부터 누적' : '월 금액'} (단위: {MILLION_WON_UNIT})
      </caption>
      <TableHead>
        <TableRow>
          <TableHeaderCell>월</TableHeaderCell>
          {ordered.map((line) => (
            <TableHeaderCell key={line.year} className="text-right">
              {line.year}년
            </TableHeaderCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {Array.from({ length: 12 }, (_, index) => (
          <TableRow key={index} data-month-row={index + 1}>
            <TableHeaderCell scope="row" className="text-left text-text-secondary">
              {index + 1}월
            </TableHeaderCell>
            {ordered.map((line) => {
              const point = line.points[index];
              return (
                <TableCell key={line.year} className="text-right">
                  {point
                    ? formatMillionWon(mode === 'cumulative' ? point.cumulative : point.amount)
                    : EMPTY_VALUE}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
