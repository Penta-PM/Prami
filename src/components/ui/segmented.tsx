'use client';

import { m } from 'motion/react';
import { useId, type KeyboardEvent } from 'react';

import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion/tokens';

import { FOCUS_RING_CLASSES } from './button';
import { controlSizeClasses, type ControlSize } from './density';

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  className?: string;
  /** 전체 높이·글자 sm 36·14 / md 44·16. 주지 않으면 가장 가까운 `data-density` 컨테이너를 따른다 (./density.tsx) */
  size?: ControlSize;
};

const PREV_KEYS = ['ArrowLeft', 'ArrowUp'];
const NEXT_KEYS = ['ArrowRight', 'ArrowDown'];

function keyDirection(key: string): -1 | 0 | 1 {
  if (PREV_KEYS.includes(key)) return -1;
  if (NEXT_KEYS.includes(key)) return 1;
  return 0;
}

/**
 * 세그먼트 컨트롤(디자인의 pill 토글). 라디오 그룹 시맨틱과 방향키 이동(순환)을 지원한다.
 * 활성 pill(흰 배경·hairline)은 `m.span layoutId` 하나가 활성 항목 사이를 `spring.layout` 으로 미끄러진다
 * (Motion 도입 스펙 §3.3 세그먼트 탭). 글자색 전환은 CSS `transition-colors`, 서버 렌더 시 숨김 initial 없음.
 * `layoutId` 는 인스턴스마다 `useId` 로 고유하게 — 한 화면에 Segmented 가 여럿이어도 pill 이 서로 섞이지 않는다.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size,
  ...rest
}: SegmentedProps<T>) {
  const pillId = `segmented-pill-${useId()}`;
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
      className={cn(
        'inline-flex gap-0.5 rounded-pill bg-neutral-100 p-[3px]',
        controlSizeClasses(size),
        className,
      )}
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
              'relative flex-1 rounded-pill border-0 bg-transparent px-3.5 py-0 font-semibold whitespace-nowrap transition-colors',
              FOCUS_RING_CLASSES,
              isActive ? 'text-text-primary' : 'text-text-tertiary hover:text-text-primary',
            )}
          >
            {isActive ? (
              <m.span
                aria-hidden="true"
                data-segmented-pill=""
                layoutId={pillId}
                transition={spring.layout}
                className="absolute inset-0 rounded-pill bg-neutral-0 shadow-(--hairline-subtle)"
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
