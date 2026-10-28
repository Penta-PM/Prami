'use client';

import { useId, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

import { MarkerSwatch } from './Marker';
import type { MarkerShape } from './palette';

/**
 * 조달 차트 공용 틀 (조달이 통합 UI-4 접근성): 범례 + "표로 보기" 전환 + 펼침 요약.
 * - 차트 svg 는 role="img" + aria-label(요약 문장) — 각 차트가 그린다.
 * - "표로 보기"(aria-pressed) 를 누르면 같은 데이터를 표로 바꿔 보여 준다(차트 ↔ 표 전환).
 * - 요약 문장은 <details> 로 화면에도 펼쳐 볼 수 있다(스크린리더 전용이 아님).
 */
export type ChartFrameProps = {
  title: string;
  /** 요약 문장 — svg aria-label 과 같은 값 */
  summary: string;
  legend?: ReactNode;
  /** 축 설명 등 짧은 안내 (예: 막대: 월별(좌축) · 선: 누적(우축)) */
  note?: ReactNode;
  /** 표로 보기 내용 */
  table: ReactNode;
  /** 차트 */
  children: ReactNode;
  /** 제목을 화면에도 보일지 (기본: 감춤 — 패널 제목이 따로 있을 때) */
  showTitle?: boolean;
  className?: string;
};

export function ChartFrame({
  title,
  summary,
  legend,
  note,
  table,
  children,
  showTitle = false,
  className,
}: ChartFrameProps) {
  const [tableView, setTableView] = useState(false);
  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-2', className)} data-chart-frame="">
      <figcaption className={showTitle ? 'text-[16px] font-semibold text-text-primary' : 'sr-only'}>
        {title}
      </figcaption>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{tableView ? null : legend}</div>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={tableView}
          onClick={() => setTableView((value) => !value)}
        >
          {tableView ? '차트로 보기' : '표로 보기'}
        </Button>
      </div>
      {note && !tableView && <p className="m-0 text-[12px] text-text-tertiary">{note}</p>}
      {tableView ? <div data-chart-table="">{table}</div> : children}
      <details className="text-[12px] text-text-secondary">
        <summary className="cursor-pointer text-text-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
          차트 요약
        </summary>
        <p className="m-0 mt-1 leading-5" data-chart-summary="">
          {summary}
        </p>
      </details>
    </figure>
  );
}

// ── 키보드·포인터 탐색 영역 ─────────────────────────────────────────

export type ChartPlotProps = {
  /** 탐색 영역 접근성 이름 (차트 제목) */
  title: string;
  /** 데이터 점(월) 수 */
  count: number;
  /** 지금 가리키는 점 — null 이면 툴팁 없음 */
  active: number | null;
  onActiveChange: (index: number | null) => void;
  /** Enter·Space·클릭 — 그 점 선택(예: 그 달 계약 목록). 없으면 선택 동작 없음 */
  onActivate?: (index: number) => void;
  /** 포커스가 들어왔을 때 처음 가리킬 점 (기본 0) */
  initialIndex?: number;
  /** 지금 점을 읽어 줄 문장(aria-live) */
  pointText: (index: number) => string;
  /** 포인터 x(영역 왼쪽 기준 px) → 점 */
  indexAt: (x: number) => number;
  children: ReactNode;
};

export const CHART_PAGE = 12;

/** 탐색 키 → 다음 점. 처리하지 않는 키면 undefined, Escape 는 null */
export function chartKeyTarget(
  key: string,
  current: number | null,
  count: number,
): number | null | undefined {
  if (count === 0) return undefined;
  const last = count - 1;
  const at = current ?? 0;
  const clamp = (value: number) => Math.min(last, Math.max(0, value));
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return current === null ? 0 : clamp(at + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return current === null ? last : clamp(at - 1);
    case 'PageDown':
      return clamp(at + CHART_PAGE);
    case 'PageUp':
      return clamp(at - CHART_PAGE);
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'Escape':
      return null;
    default:
      return undefined;
  }
}

/**
 * 키보드로 데이터 점(월)을 옮기며 툴팁을 보는 영역. Tab 으로 들어오면 첫 점(또는 initialIndex)에 툴팁,
 * ←→(↑↓) 1칸, PageUp/PageDown 12칸, Home/End 끝, Enter/Space 선택, Esc 툴팁 닫기. 지금 점은 aria-live 로 읽는다.
 * 포커스 표시: 영역 외곽 2px 고리(focus-visible) + 차트 안 해당 칸 테두리(각 차트가 active 칸에 그린다).
 */
export function ChartPlot({
  title,
  count,
  active,
  onActiveChange,
  onActivate,
  initialIndex = 0,
  pointText,
  indexAt,
  children,
}: ChartPlotProps) {
  const hintId = useId();
  const [focused, setFocused] = useState(false);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && active !== null && onActivate) {
      event.preventDefault();
      onActivate(active);
      return;
    }
    const next = chartKeyTarget(event.key, active, count);
    if (next === undefined) return;
    event.preventDefault();
    onActiveChange(next);
  };

  const pointerIndex = (event: { clientX: number; currentTarget: HTMLElement }) =>
    indexAt(event.clientX - event.currentTarget.getBoundingClientRect().left);

  return (
    <div className="relative min-w-0">
      <div
        tabIndex={count > 0 ? 0 : -1}
        role="group"
        aria-roledescription="차트"
        aria-label={title}
        aria-describedby={hintId}
        data-chart-plot=""
        // 클릭으로 그 달을 선택(onActivate)하는 차트만 손가락 커서 (UX PR-U1 §2) — 마우스 이동 툴팁만 있는 차트는 기본 커서
        data-clickable={onActivate && count > 0 ? '' : undefined}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true);
          if (active === null && count > 0)
            onActiveChange(Math.min(count - 1, Math.max(0, initialIndex)));
        }}
        onBlur={() => {
          setFocused(false);
          onActiveChange(null);
        }}
        onPointerMove={(event) => {
          if (count > 0 && event.pointerType !== 'touch') onActiveChange(pointerIndex(event));
        }}
        onPointerLeave={() => {
          if (!focused) onActiveChange(null);
        }}
        onClick={(event) => {
          if (count === 0) return;
          const index = pointerIndex(event);
          onActiveChange(index);
          onActivate?.(index);
        }}
        className="relative rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {children}
      </div>
      <p id={hintId} className="sr-only">
        좌우 화살표 키로 월을 옮기며 값을 확인합니다.
        {onActivate ? ' Enter 키로 그 달을 선택합니다.' : ''}
      </p>
      <p aria-live="polite" className="sr-only" data-chart-live="">
        {focused && active !== null ? pointText(active) : ''}
      </p>
    </div>
  );
}

// ── 툴팁 (HTML — 글자 크기·줄바꿈·확대가 svg 보다 낫다) ─────────────────────

export type TooltipRow = {
  key: string;
  label: string;
  color: string;
  marker: MarkerShape;
  isOurs?: boolean;
  values: readonly string[];
};

export type ChartTooltipProps = {
  /** 가리키는 점의 x(px, 영역 왼쪽 기준) */
  x: number;
  /** 영역 너비(px) — 넘치면 점 왼쪽으로 */
  width: number;
  title: string;
  columns: readonly string[];
  rows: readonly TooltipRow[];
  /** "외 N개사" 등 회색 행 */
  others?: { label: string; values: readonly string[] } | null;
  total?: { label: string; values: readonly string[] } | null;
  note?: string;
};

const TOOLTIP_WIDTH = 248;

export function ChartTooltip({
  x,
  width,
  title,
  columns,
  rows,
  others,
  total,
  note,
}: ChartTooltipProps) {
  const left =
    width <= TOOLTIP_WIDTH + 8
      ? 4
      : x + 12 + TOOLTIP_WIDTH > width
        ? Math.max(4, x - 12 - TOOLTIP_WIDTH)
        : x + 12;
  const grid = { gridTemplateColumns: `minmax(0,1fr) repeat(${columns.length}, auto)` };
  return (
    <div
      role="tooltip"
      data-chart-tooltip=""
      className="pointer-events-none absolute top-2 z-10 max-w-[calc(100%-8px)] rounded-md border border-solid border-border-default bg-surface-card p-2.5 text-[12px] shadow-(--shadow-elevated)"
      style={{ left, width: TOOLTIP_WIDTH }}
    >
      <p className="m-0 mb-1.5 font-bold text-text-primary">{title}</p>
      <div className="grid items-center gap-x-3 gap-y-1 tabular-nums" style={grid}>
        <span />
        {columns.map((column) => (
          <span key={column} className="text-right text-text-tertiary">
            {column}
          </span>
        ))}
        {rows.map((row) => (
          <TooltipLine key={row.key} row={row} />
        ))}
        {others && (
          <>
            <span className="truncate pl-5 text-text-tertiary">{others.label}</span>
            {others.values.map((value, index) => (
              <span key={index} className="text-right text-text-tertiary">
                {value}
              </span>
            ))}
          </>
        )}
        {total && (
          <>
            <span className="border-0 border-t border-solid border-border-subtle pt-1 font-bold text-text-secondary">
              {total.label}
            </span>
            {total.values.map((value, index) => (
              <span
                key={index}
                className="border-0 border-t border-solid border-border-subtle pt-1 text-right font-bold text-text-primary"
              >
                {value}
              </span>
            ))}
          </>
        )}
      </div>
      {note && <p className="m-0 mt-1.5 text-[11px] text-text-tertiary">{note}</p>}
    </div>
  );
}

function TooltipLine({ row }: { row: TooltipRow }) {
  const weight = row.isOurs ? 'font-bold' : 'font-normal';
  return (
    <>
      <span
        className={cn(
          'flex min-w-0 items-center gap-1.5',
          row.isOurs ? 'text-accent-ours' : 'text-text-secondary',
          weight,
        )}
      >
        <MarkerSwatch shape={row.marker} color={row.color} />
        <span className="truncate">{row.label}</span>
      </span>
      {row.values.map((value, index) => (
        <span key={index} className={cn('text-right text-text-primary', weight)}>
          {value}
        </span>
      ))}
    </>
  );
}
