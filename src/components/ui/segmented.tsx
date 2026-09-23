'use client';

import type { KeyboardEvent } from 'react';

import { cn } from '@/lib/cn';

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  className?: string;
};

const PREV_KEYS = ['ArrowLeft', 'ArrowUp'];
const NEXT_KEYS = ['ArrowRight', 'ArrowDown'];

function keyDirection(key: string): -1 | 0 | 1 {
  if (PREV_KEYS.includes(key)) return -1;
  if (NEXT_KEYS.includes(key)) return 1;
  return 0;
}

/** 세그먼트 컨트롤(디자인의 pill 토글). 라디오 그룹 시맨틱과 방향키 이동(순환)을 지원한다 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  ...rest
}: SegmentedProps<T>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = keyDirection(event.key);
    if (direction === 0 || options.length === 0) return;
    event.preventDefault();
    const currentIndex = options.findIndex((option) => option.value === value);
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    const next = options[nextIndex];
    if (!next) return;
    onChange(next.value);
    const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={rest['aria-label']}
      onKeyDown={handleKeyDown}
      className={cn('inline-flex gap-0.5 rounded-pill bg-gray-100 p-[3px]', className)}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 rounded-pill border-0 px-3.5 py-[7px] text-[12px] font-semibold transition-colors',
              isActive
                ? 'bg-white text-ink-900 shadow-(--hairline-subtle)'
                : 'bg-transparent text-text-tertiary hover:text-ink-900',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
