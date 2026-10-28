'use client';

import { useRef, useState } from 'react';

import { MonthRangeSlider, type MonthRangeValue, type MonthVolumeBar } from '@/components/ui';
import { chipClass } from '@/components/ui/chip';
import { controlSizeClasses } from '@/components/ui/density';
import { FIELD_CLASSES } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { isMonthKey, type MonthKey } from '@/lib/month';
import type { PeriodPreset } from '@/lib/procurement/performance-filter';

export type PeriodFilterProps = {
  value: MonthRangeValue;
  /** 고를 수 있는 월 (오름차순) */
  months: readonly MonthKey[];
  presets: readonly PeriodPreset[];
  /** 배경 히스토그램 — 월별 거래 규모 (getMonthVolumes, 조회 기간과 무관하게 전체) */
  volumes: readonly MonthVolumeBar[];
  onChange: (next: MonthRangeValue) => void;
};

/** 시작·종료 월 입력 — 공용 입력창 모양, 필터라 sm(36·14) */
const INPUT_CLASS = cn(FIELD_CLASSES, controlSizeClasses('sm'), 'w-auto px-3 tabular-nums');

/**
 * 조회 기간 (원본 PeriodFilter): "조회 기간" + 시작·종료 월 입력 + 프리셋(올해·최근 3개월·최근 1년·전체) + 월 슬라이더(UI-4,
 * 월별 거래량 배경). 슬라이더는 끄는 동안 표시만 바꾸고 손을 뗄 때 한 번 URL 에 반영한다(원본: 손을 떼는 순간 기간이 바뀐다).
 * 시작월이 종료월을 넘지 않게 한쪽을 바꾸면 다른 쪽을 맞춘다(원본).
 */
export function PeriodFilter({ value, months, presets, volumes, onChange }: PeriodFilterProps) {
  const base = `${value.from}~${value.to}`;
  const [draft, setDraft] = useState<{ base: string; value: MonthRangeValue } | null>(null);
  // URL(값)이 바뀌면 끌던 값은 버린다
  const shown = draft && draft.base === base ? draft.value : value;
  // 끄는 중인 값 (손을 뗄 때 반영) — 렌더 밖(이벤트)에서만 읽고 쓴다
  const dragging = useRef<MonthRangeValue | null>(null);

  const min = months[0];
  const max = months.at(-1);
  const apply = (next: MonthRangeValue) => {
    if (next.from === value.from && next.to === value.to) return;
    setDraft({ base, value: next });
    onChange(next);
  };
  const setStart = (from: string) => {
    if (!isMonthKey(from)) return;
    apply({ from, to: from > value.to ? from : value.to });
  };
  const setEnd = (to: string) => {
    if (!isMonthKey(to)) return;
    apply({ from: to < value.from ? to : value.from, to });
  };

  return (
    <section
      aria-label="조회 기간"
      className="flex min-w-0 flex-col gap-3 rounded-2xl bg-surface-card px-4 py-3.5 shadow-(--hairline-default) sm:px-5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <h2 className="m-0 mr-1 text-text-primary [font:var(--text-h2)]">조회 기간</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="month"
            aria-label="조회 시작월"
            className={INPUT_CLASS}
            value={shown.from}
            min={min}
            max={max}
            onChange={(event) => setStart(event.target.value)}
          />
          <span aria-hidden="true" className="text-text-tertiary">
            ~
          </span>
          <input
            type="month"
            aria-label="조회 종료월"
            className={INPUT_CLASS}
            value={shown.to}
            min={min}
            max={max}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
        <div role="group" aria-label="기간 프리셋" className="flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const active = preset.from === shown.from && preset.to === shown.to;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={active}
                onClick={() => apply({ from: preset.from, to: preset.to })}
                className={chipClass(active)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="m-0 text-[12px] text-text-tertiary">
        양 끝 손잡이를 좌우로 끌어서 기간을 고르세요
      </p>
      <MonthRangeSlider
        months={months}
        value={shown}
        volumes={volumes}
        onChange={(next) => {
          dragging.current = next;
          setDraft({ base, value: next });
        }}
        onCommit={() => {
          const next = dragging.current;
          dragging.current = null;
          if (next && (next.from !== value.from || next.to !== value.to)) onChange(next);
        }}
      />
    </section>
  );
}
