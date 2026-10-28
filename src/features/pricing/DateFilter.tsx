'use client';

import { m } from 'motion/react';

import { Presence } from '@/components/motion/Presence';
import { Segmented } from '@/components/ui';
import { chipClass } from '@/components/ui/chip';
import { fade } from '@/lib/motion/tokens';

import { activeYear, ALL, yearRange, type DateMode, type FilterErrors } from './filter';

export type DateFilterValue = { dateMode: DateMode; from?: string; to?: string };

type DateControlsProps = {
  filter: DateFilterValue;
  errors: FilterErrors;
  years: readonly number[];
  onChange: (patch: Partial<DateFilterValue>) => void;
};

const DATE_MODE_OPTIONS = [
  { value: 'start', label: '적용시작일 기준' },
  { value: 'period', label: '적용기간 기준' },
] as const;

/** 연도 퀵칩 최대 개수 (최근 연도부터) */
const MAX_YEAR_CHIPS = 9;

const DATE_CLASS =
  'rounded-pill border-0 bg-surface-card px-3 py-2 text-[12px] font-semibold text-text-secondary shadow-(--hairline-default) outline-none';

/** 칩 클래스는 표 열 필터 칩과 공유하려고 components/ui/chip 으로 옮겼다 (기존 import 경로 유지) */
export { chipClass };

/**
 * 날짜 기준(적용시작일/적용기간) + 전체·연도 칩 + 기간 입력 (§4.5.2, R-13).
 * 가격정책 조회·관리와 원가 관리(R-14)가 같은 컴포넌트를 쓴다.
 */
export function DateControls({ filter, errors, years, onChange }: DateControlsProps) {
  const year = activeYear(filter);
  const noDate = !filter.from && !filter.to;
  const message = errors.from ?? errors.to;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        aria-label="날짜 기준"
        options={DATE_MODE_OPTIONS}
        value={filter.dateMode}
        onChange={(dateMode: DateMode) => onChange({ dateMode })}
      />
      <button
        type="button"
        aria-pressed={noDate}
        className={chipClass(noDate)}
        onClick={() => onChange({ from: undefined, to: undefined })}
      >
        {ALL}
      </button>
      {years.slice(0, MAX_YEAR_CHIPS).map((chip) => (
        <button
          key={chip}
          type="button"
          aria-pressed={year === chip}
          className={chipClass(year === chip)}
          onClick={() => onChange(yearRange(chip))}
        >
          {chip}
        </button>
      ))}
      <input
        type="date"
        aria-label="시작일"
        className={DATE_CLASS}
        defaultValue={filter.from ?? ''}
        key={`from-${filter.from ?? ''}`}
        onChange={(event) => onChange({ from: event.target.value || undefined })}
      />
      <span className="text-[12px] text-text-tertiary">~</span>
      <input
        type="date"
        aria-label="종료일"
        className={DATE_CLASS}
        defaultValue={filter.to ?? ''}
        key={`to-${filter.to ?? ''}`}
        onChange={(event) => onChange({ to: event.target.value || undefined })}
      />
      <Presence>
        {message ? (
          <m.span
            key="message"
            role="alert"
            variants={fade}
            initial="initial"
            animate="animate"
            exit="exit"
            className="text-[12px] text-text-danger"
          >
            {message}
          </m.span>
        ) : null}
      </Presence>
    </div>
  );
}
