'use client';

import { useState } from 'react';

import { cn } from '@/lib/cn';

import { MarkerSwatch } from './Marker';
import type { MarkerShape } from './palette';

export type LegendItem = {
  key: string;
  /** 짧은 표시 이름 */
  label: string;
  /** 원문 이름(title 툴팁) — 없으면 label */
  title?: string;
  color: string;
  marker: MarkerShape;
  isOurs?: boolean;
};

export type ChartLegendProps = {
  items: readonly LegendItem[];
  /** 강조 중인 계열 — 다른 계열은 흐리게 */
  highlightKey: string | null;
  onHighlightChange: (key: string | null) => void;
  /** 숨긴 계열 */
  hiddenKeys: ReadonlySet<string>;
  onToggleHidden: (key: string) => void;
  /** 이 수만큼만 보이고 나머지는 "+N개 ▾" 로 접는다 (강조 중인 항목은 접혀도 보인다). 없으면 전부 */
  visibleCount?: number;
  /** 접힌 항목 단위 — `개사`(회사) / `개`(연도 등) */
  unit?: string;
  'aria-label'?: string;
};

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-purple-500';

/**
 * 차트 범례 (조달이 TrendLegend 이식). 항목마다 두 버튼:
 * - 이름 버튼 = 강조 토글(aria-pressed) — 다시 누르면 해제. 표와 강조 연동(UI-5)은 highlightKey 를 공유한다.
 * - 눈 버튼 = 표시/숨김 토글(aria-pressed = 숨김) — 숨긴 계열은 막대·선·축 범위·툴팁에서 빠진다(표로 보기는 전체 유지).
 * 자사는 `--accent-ours` 색 + 굵게 + "자사" 글자(색 외 구분).
 */
export function ChartLegend({
  items,
  highlightKey,
  onHighlightChange,
  hiddenKeys,
  onToggleHidden,
  visibleCount,
  unit = '개',
  'aria-label': ariaLabel = '범례',
}: ChartLegendProps) {
  const [expanded, setExpanded] = useState(false);
  const limit = visibleCount ?? items.length;
  const hiddenCount = Math.max(0, items.length - limit);
  const shown = items.filter(
    (item, index) => expanded || index < limit || item.key === highlightKey,
  );

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1" data-chart-legend="">
      <ul aria-label={ariaLabel} className="m-0 flex list-none flex-wrap gap-x-1 gap-y-1 p-0">
        {shown.map((item) => {
          const highlighted = highlightKey === item.key;
          const hidden = hiddenKeys.has(item.key);
          return (
            <li
              key={item.key}
              data-legend-item={item.key}
              className={cn(
                'flex items-center rounded-full border border-solid',
                highlighted ? 'border-border-default bg-surface-muted' : 'border-transparent',
              )}
            >
              <button
                type="button"
                aria-pressed={highlighted}
                title={item.title ?? item.label}
                onClick={() => onHighlightChange(highlighted ? null : item.key)}
                className={cn(
                  'flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent py-1 pr-1 pl-2 text-[12px]',
                  hidden
                    ? 'text-text-tertiary line-through'
                    : item.isOurs
                      ? 'text-accent-ours'
                      : 'text-text-secondary',
                  highlightKey && !highlighted
                    ? 'font-normal'
                    : item.isOurs
                      ? 'font-bold'
                      : 'font-semibold',
                  FOCUS,
                )}
              >
                <MarkerSwatch shape={item.marker} color={item.color} />
                <span>{item.label}</span>
                {item.isOurs && (
                  <span className="rounded-sm bg-accent-ours px-1 text-[10px] leading-4 font-semibold text-white">
                    자사
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-pressed={hidden}
                aria-label={`${item.label} ${hidden ? '보이기' : '숨기기'}`}
                title={hidden ? '보이기' : '숨기기'}
                onClick={() => onToggleHidden(item.key)}
                className={cn(
                  'flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-text-tertiary hover:text-ink-900',
                  FOCUS,
                )}
              >
                <EyeIcon off={hidden} />
              </button>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            'min-h-8 cursor-pointer rounded-full border-0 bg-transparent px-2 text-[12px] font-semibold text-text-tertiary hover:text-ink-900',
            FOCUS,
          )}
        >
          {expanded ? '접기 ▴' : `+${hiddenCount}${unit} ▾`}
        </button>
      )}
    </div>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
      {off && <path d="M2.5 13.5l11-11" />}
    </svg>
  );
}
