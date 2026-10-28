'use client';

import { useMemo, useRef, useState } from 'react';

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatMonthLong, type MonthKey } from '@/lib/month';
import { formatEokMan, formatMillionWon, MILLION_WON_UNIT } from '@/lib/procurement/format';

import { ChartFrame, ChartPlot, ChartTooltip, type TooltipRow } from './ChartFrame';
import { ChartLegend, type LegendItem } from './ChartLegend';
import { Marker } from './Marker';
import { seriesColor, seriesMarker } from './palette';
import {
  bandLayout,
  comboSummary,
  cumulative,
  linearScale,
  monthAxisLabel,
  monthTickStep,
  monthTotals,
  niceTicks,
  orderSeries,
  shortCompanyName,
  stackSegments,
  type ComboSeries,
} from './scale';
import { useControllable, useHiddenKeys } from './use-controllable';
import { useElementWidth } from './use-element-width';

export type ComboChartProps = {
  /** 차트 제목 — 접근성 이름·요약 문장·표 캡션 */
  title: string;
  /** x축 월(오름차순) */
  months: readonly MonthKey[];
  /** 계열 — values 는 months 와 같은 길이(월 금액, 원). 자사(isOurs)는 맨 아래 막대·맨 위 선 */
  series: readonly ComboSeries[];
  /** 강조 계열 (제어형 — UI-5 제조사 표와 연동). 없으면 범례가 내부 상태로 */
  highlightKey?: string | null;
  onHighlightChange?: (key: string | null) => void;
  /** 선택한 달 (클릭·Enter) — 다시 고르면 null */
  selectedMonth?: MonthKey | null;
  onSelectMonth?: (month: MonthKey | null) => void;
  /** 범례에 처음 보일 계열 수 (기본 4, 나머지는 "+N개사") */
  legendVisibleCount?: number;
  /** 툴팁 끝 안내 (예: "클릭하면 계약 목록") */
  activateHint?: string;
  showTitle?: boolean;
  className?: string;
};

/** 툴팁에 이름으로 보일 경쟁사 수 (나머지는 "외 N개사") — 조달이 원본 */
const TOOLTIP_RIVALS = 3;

/** 1px 선 좌표 — 정수 + 0.5 (화소 한 줄에 정확히 걸친다) */
const crisp = (value: number) => Math.round(value) + 0.5;

/**
 * 막대 경계(왼·오른·위·아래)를 정수 화소로 스냅한 rect 속성 — x·y·width·height 가 정수.
 * 테두리 굵기가 홀수(1px)면 x·y 만 +0.5 옮겨 테두리가 화소 한 줄에 걸치게 한다(가장자리 번짐 방지).
 * 0 이 아닌 조각은 반올림으로 사라지지 않게 높이 최소 1px.
 */
function snapBar(left: number, right: number, top: number, bottom: number, strokeWidth: number) {
  const l = Math.round(left);
  const r = Math.round(right);
  const b = Math.round(bottom);
  const t = bottom > top ? Math.min(Math.round(top), b - 1) : b;
  const shift = strokeWidth % 2 === 1 ? 0.5 : 0;
  return { x: l + shift, y: t + shift, width: Math.max(0, r - l), height: b - t };
}

/**
 * 너비(px) → 그리기 치수. 좁으면 축 여백을 줄인다.
 * W 는 잰 실수 너비 그대로(반올림하면 viewBox 와 실제 너비가 어긋나 전체가 화소 격자에서 밀린다), 높이는 정수.
 */
export function comboDims(width: number) {
  const W = Math.max(280, width);
  const H = Math.round(Math.min(400, Math.max(240, W * 0.42)));
  const pad = W < 480 ? { l: 54, r: 54, t: 30, b: 28 } : { l: 78, r: 78, t: 34, b: 28 };
  const IW = W - pad.l - pad.r;
  const IH = H - pad.t - pad.b;
  return { W, H, pad, IW, IH, BASE: pad.t + IH };
}

/**
 * 월별(막대) + 누적(선) 2축 콤보 차트 (조달이 TrendComboChart 이식, 새 의존성 없음 — 순수 svg).
 * - 막대: 월마다 계열 금액을 쌓음(자사 맨 아래) — 좌축. 선: 시작 월부터 계열별 누적 — 우축(규모가 커서 축 분리).
 * - 막대는 계열색 35% 채움 + 계열색 테두리(그래픽 3:1), 선은 카드색 halo 위 계열색, 점 표식 모양으로 색 외 구분.
 * - 접근성: svg role="img"+요약, 펼침 요약, 표로 보기, 키보드 월 이동·툴팁(aria-live). 금액 = 억·만(D-3), 표 = 백만원.
 */
export function ComboChart({
  title,
  months,
  series,
  highlightKey: highlightProp,
  onHighlightChange,
  selectedMonth = null,
  onSelectMonth,
  legendVisibleCount = 4,
  activateHint,
  showTitle,
  className,
}: ComboChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const d = comboDims(useElementWidth(boxRef, 640));
  const [highlightKey, setHighlightKey] = useControllable<string | null>(
    highlightProp,
    onHighlightChange,
    null,
  );
  const [hiddenKeys, toggleHidden] = useHiddenKeys();
  const [active, setActive] = useState<number | null>(null);

  const ordered = useMemo(
    () =>
      orderSeries(series).map(({ item, rank }) => ({
        ...item,
        color: seriesColor(rank, item.isOurs),
        marker: seriesMarker(rank, item.isOurs),
        label: shortCompanyName(item.name),
        cumulative: cumulative(item.values),
      })),
    [series],
  );
  const visible = ordered.filter((item) => !hiddenKeys.has(item.key));
  const count = months.length;
  const summary = comboSummary(title, months, series);

  const totals = monthTotals(visible, count);
  const leftTicks = niceTicks(Math.max(0, ...totals));
  const rightTicks = niceTicks(Math.max(0, ...visible.map((item) => item.cumulative.at(-1) ?? 0)));
  const yLeft = linearScale(leftTicks.at(-1)!, d.BASE, d.pad.t);
  const yRight = linearScale(rightTicks.at(-1)!, d.BASE, d.pad.t);
  const band = bandLayout(count, d.pad.l, d.IW);
  const barW = Math.max(3, band.bandWidth * 0.62);
  const stacks = stackSegments(visible, count);
  const byKey = new Map(visible.map((item) => [item.key, item]));
  const tickStep = monthTickStep(count, band.bandWidth);
  // 자사 선을 맨 마지막(맨 위)에
  const lineOrder = [...visible].sort((a, b) => Number(!!a.isOurs) - Number(!!b.isOurs));
  const dimmed = (key: string) => highlightKey !== null && highlightKey !== key;
  const selectedIndex = selectedMonth ? months.indexOf(selectedMonth) : -1;

  const legendItems: LegendItem[] = ordered.map((item) => ({
    key: item.key,
    label: item.label,
    title: item.name,
    color: item.color,
    marker: item.marker,
    isOurs: item.isOurs,
  }));

  const tooltipData = (index: number) => {
    const all = visible
      .map((item) => ({
        item,
        month: item.values[index] ?? 0,
        cum: item.cumulative[index] ?? 0,
      }))
      .sort((a, b) => b.cum - a.cum);
    const rivals = all.filter(({ item }) => !item.isOurs);
    const keep = new Set([
      ...all.filter(({ item }) => item.isOurs).map(({ item }) => item.key),
      ...rivals.slice(0, TOOLTIP_RIVALS).map(({ item }) => item.key),
    ]);
    if (highlightKey) keep.add(highlightKey);
    const shown = all.filter(({ item }) => keep.has(item.key));
    const rest = all.filter(({ item }) => !keep.has(item.key));
    const sum = (rows: typeof all, field: 'month' | 'cum') =>
      rows.reduce((acc, row) => acc + row[field], 0);
    return { shown, rest, month: sum(all, 'month'), cum: sum(all, 'cum') };
  };

  const pointText = (index: number) => {
    const { shown, rest, month, cum } = tooltipData(index);
    const parts = shown.map(
      ({ item, month: m, cum: c }) =>
        `${item.isOurs ? '자사 ' : ''}${item.label} 월 ${formatEokMan(m)}, 누적 ${formatEokMan(c)}`,
    );
    if (rest.length) parts.push(`외 ${rest.length}개사`);
    return `${formatMonthLong(months[index]!)}: 합계 월 ${formatEokMan(month)}, 누적 ${formatEokMan(cum)}. ${parts.join('. ')}`;
  };

  const tooltip = (index: number) => {
    const { shown, rest, month, cum } = tooltipData(index);
    const rows: TooltipRow[] = shown.map(({ item, month: m, cum: c }) => ({
      key: item.key,
      label: item.label,
      color: item.color,
      marker: item.marker,
      isOurs: item.isOurs,
      values: [formatEokMan(m), formatEokMan(c)],
    }));
    return (
      <ChartTooltip
        x={band.center(index)}
        width={d.W}
        title={formatMonthLong(months[index]!)}
        columns={['월 금액', '누적']}
        rows={rows}
        others={
          rest.length
            ? {
                label: `외 ${rest.length}개사`,
                values: [
                  formatEokMan(rest.reduce((acc, row) => acc + row.month, 0)),
                  formatEokMan(rest.reduce((acc, row) => acc + row.cum, 0)),
                ],
              }
            : null
        }
        total={{ label: '합계', values: [formatEokMan(month), formatEokMan(cum)] }}
        note={activateHint}
      />
    );
  };

  const table = (
    <ComboTable title={title} months={months} series={ordered} selectedMonth={selectedMonth} />
  );

  return (
    <ChartFrame
      title={title}
      summary={summary}
      showTitle={showTitle}
      className={className}
      note="막대: 월별 금액(좌축) · 선: 시작 월부터 누적 금액(우축)"
      legend={
        <ChartLegend
          items={legendItems}
          highlightKey={highlightKey}
          onHighlightChange={setHighlightKey}
          hiddenKeys={hiddenKeys}
          onToggleHidden={toggleHidden}
          visibleCount={legendVisibleCount}
          unit="개사"
          aria-label={`${title} 범례`}
        />
      }
      table={table}
    >
      <div ref={boxRef} className="w-full min-w-0">
        {count === 0 ? (
          <p className="m-0 py-10 text-center text-[14px] text-text-tertiary">
            표시할 데이터가 없습니다
          </p>
        ) : (
          <ChartPlot
            title={title}
            count={count}
            active={active}
            onActiveChange={setActive}
            initialIndex={selectedIndex >= 0 ? selectedIndex : 0}
            onActivate={
              onSelectMonth
                ? (index) => onSelectMonth(selectedMonth === months[index] ? null : months[index]!)
                : undefined
            }
            pointText={pointText}
            indexAt={band.indexAt}
          >
            <svg
              role="img"
              aria-label={summary}
              viewBox={`0 0 ${d.W} ${d.H}`}
              width="100%"
              height={d.H}
              className="block overflow-visible"
              data-combo-chart=""
            >
              {/* 선택·가리킨 달 띠 */}
              {months.map((month, index) =>
                index === selectedIndex || index === active ? (
                  <rect
                    key={`band-${month}`}
                    x={band.left(index)}
                    y={d.pad.t}
                    width={band.bandWidth}
                    height={d.IH}
                    fill="var(--surface-muted)"
                  />
                ) : null,
              )}

              {/* 가로 격자 + 좌축(월별) */}
              {leftTicks.map((tick) => (
                <g key={`l-${tick}`}>
                  {/* 1px 격자 = 정수 + 0.5 에 그려 화소 한 줄에 맞춘다 */}
                  <line
                    data-grid=""
                    x1={d.pad.l}
                    x2={Math.round(d.W - d.pad.r)}
                    y1={crisp(yLeft(tick))}
                    y2={crisp(yLeft(tick))}
                    stroke="var(--border-default)"
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={d.pad.l - 8}
                    y={yLeft(tick) + 4}
                    textAnchor="end"
                    fontSize={12}
                    fill="var(--slate-700-aa)"
                    className="tabular-nums"
                  >
                    {formatEokMan(tick)}
                  </text>
                </g>
              ))}
              {/* 우축(누적) */}
              {rightTicks.map((tick) => (
                <text
                  key={`r-${tick}`}
                  x={d.W - d.pad.r + 8}
                  y={yRight(tick) + 4}
                  textAnchor="start"
                  fontSize={12}
                  fill="var(--slate-700-aa)"
                  className="tabular-nums"
                >
                  {formatEokMan(tick)}
                </text>
              ))}
              <text
                x={d.pad.l - 8}
                y={d.pad.t - 16}
                textAnchor="end"
                fontSize={12}
                fontWeight={600}
                fill="var(--slate-600-aa)"
              >
                월별(막대)
              </text>
              <text
                x={d.W - d.pad.r + 8}
                y={d.pad.t - 16}
                textAnchor="start"
                fontSize={12}
                fontWeight={600}
                fill="var(--slate-600-aa)"
              >
                누적(선)
              </text>

              {/* x축 월 */}
              {months.map((month, index) =>
                index % tickStep === 0 || index === count - 1 ? (
                  <text
                    key={`x-${month}`}
                    x={band.center(index)}
                    y={d.H - d.pad.b + 18}
                    textAnchor="middle"
                    fontSize={12}
                    fill="var(--slate-700-aa)"
                  >
                    {monthAxisLabel(month, index)}
                  </text>
                ) : null,
              )}

              {/* 쌓은 막대 */}
              {stacks.map((segments, index) =>
                segments.map((segment) => {
                  const item = byKey.get(segment.key)!;
                  const selected =
                    index === selectedIndex && (!highlightKey || highlightKey === segment.key);
                  const strokeWidth = selected ? 2 : 1;
                  const box = snapBar(
                    band.center(index) - barW / 2,
                    band.center(index) + barW / 2,
                    yLeft(segment.to),
                    yLeft(segment.from),
                    strokeWidth,
                  );
                  return (
                    <rect
                      key={`${segment.key}-${index}`}
                      data-bar={`${segment.key}:${months[index]}`}
                      {...box}
                      fill={item.color}
                      fillOpacity={0.35}
                      stroke={selected ? 'var(--ink-900)' : item.color}
                      strokeWidth={strokeWidth}
                      opacity={dimmed(segment.key) ? 0.2 : 1}
                      className="transition-opacity duration-150 motion-reduce:transition-none"
                    />
                  );
                }),
              )}

              {/* 누적선 */}
              {lineOrder.map((item) => {
                const width = (item.isOurs ? 3 : 2) + (highlightKey === item.key ? 1 : 0);
                const path = item.cumulative
                  .map(
                    (value, index) =>
                      `${index === 0 ? 'M' : 'L'}${band.center(index)},${yRight(value)}`,
                  )
                  .join(' ');
                const showMarkers = count <= 24;
                return (
                  <g
                    key={`line-${item.key}`}
                    data-line={item.key}
                    opacity={dimmed(item.key) ? 0.15 : 1}
                    className="transition-opacity duration-150 motion-reduce:transition-none"
                  >
                    <path
                      d={path}
                      fill="none"
                      stroke="var(--surface-card)"
                      strokeWidth={width + 3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke={item.color}
                      strokeWidth={width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {item.cumulative.map((value, index) =>
                      showMarkers || index === active ? (
                        <Marker
                          key={index}
                          shape={item.marker}
                          x={band.center(index)}
                          y={yRight(value)}
                          r={index === active ? 5 : 3.5}
                          color={item.color}
                        />
                      ) : null,
                    )}
                  </g>
                );
              })}

              {/* 가리킨 달 테두리 (포커스 표시) */}
              {active !== null && (
                <rect
                  data-active-month={months[active]}
                  x={band.left(active) + 1}
                  y={d.pad.t + 1}
                  width={Math.max(0, band.bandWidth - 2)}
                  height={d.IH - 2}
                  fill="none"
                  stroke="var(--purple-500)"
                  strokeWidth={2}
                  rx={3}
                />
              )}
            </svg>
            {active !== null && tooltip(active)}
          </ChartPlot>
        )}
      </div>
    </ChartFrame>
  );
}

/** 표로 보기 — 차트와 같은 데이터(숨긴 계열 포함 전체). 표 금액 = 백만원(D-3, 단위는 캡션에 한 번) */
function ComboTable({
  title,
  months,
  series,
  selectedMonth,
}: {
  title: string;
  months: readonly MonthKey[];
  series: readonly (ComboSeries & { label: string })[];
  selectedMonth: MonthKey | null;
}) {
  const totals = monthTotals(series, months.length);
  const running = cumulative(totals);
  const seriesTotal = (item: ComboSeries) => item.values.reduce((sum, value) => sum + value, 0);
  return (
    <Table className="tabular-nums">
      <caption className="pb-2 text-left text-[12px] text-text-tertiary">
        {title} (단위: {MILLION_WON_UNIT})
      </caption>
      <TableHead>
        <TableRow>
          <TableHeaderCell>월</TableHeaderCell>
          {series.map((item) => (
            <TableHeaderCell
              key={item.key}
              title={item.name}
              className={cn('text-right', item.isOurs && 'font-bold text-accent-ours')}
            >
              {item.label}
              {item.isOurs ? ' (자사)' : ''}
            </TableHeaderCell>
          ))}
          <TableHeaderCell className="text-right">합계</TableHeaderCell>
          <TableHeaderCell className="text-right">누적 합계</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {months.map((month, index) => (
          <TableRow
            key={month}
            data-month-row={month}
            data-selected={month === selectedMonth || undefined}
            className={month === selectedMonth ? 'bg-surface-muted' : undefined}
          >
            <TableHeaderCell scope="row" className="text-left text-text-secondary">
              {formatMonthLong(month)}
            </TableHeaderCell>
            {series.map((item) => (
              <TableCell key={item.key} className="text-right">
                {formatMillionWon(item.values[index] ?? 0)}
              </TableCell>
            ))}
            <TableCell className="text-right font-semibold">
              {formatMillionWon(totals[index])}
            </TableCell>
            <TableCell className="text-right">{formatMillionWon(running[index])}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <tfoot>
        <TableRow>
          <TableHeaderCell scope="row" className="text-left">
            합계
          </TableHeaderCell>
          {series.map((item) => (
            <TableCell key={item.key} className="text-right font-semibold">
              {formatMillionWon(seriesTotal(item))}
            </TableCell>
          ))}
          <TableCell className="text-right font-bold">
            {formatMillionWon(running.at(-1) ?? 0)}
          </TableCell>
          <TableCell />
        </TableRow>
      </tfoot>
    </Table>
  );
}
