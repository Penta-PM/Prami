'use client';

import { useEffect, useRef, type InputHTMLAttributes, type Ref, type SVGProps } from 'react';

import { cn } from '@/lib/cn';

import { FOCUS_RING_CLASSES } from './button';

/**
 * 공용 Checkbox·Radio (빠른 필터 바 디자인 보정 §7.3). 네이티브 input 을 그대로 쓰고(`appearance-none`) 체크·가로선·점만 SVG/span 으로
 * 그린다 — 레이블 연결·폼 제출·키보드·접근성 이름은 네이티브 그대로. 체크 표시 디자인을 앱에서 하나로 맞춘다.
 *
 * - 크기: sm 16px / md 18px(기본). 클릭 영역은 감싸는 행(label, 40px+)이 넓힌다.
 * - 기본: 흰 배경 + 테두리 1.5px `neutral-600`(흰 배경 6.6:1 — `--border-default`(N200) 는 3:1 미달이라 쓰지 않는다).
 * - hover(체크 안 됨): 테두리 `neutral-900`·배경 `neutral-50`.
 * - checked·indeterminate: `primary-600`(Penta P600) 배경 + 흰 체크/가로선(흰색 대비 6.35:1).
 * - disabled: `opacity-50`. focus-visible: 2px `--focus-ring`(P500) outline offset 2 (Button 과 같은 FOCUS_RING_CLASSES).
 * - Radio: 같은 체계, 원형 + 가운데 흰 점 8px.
 */
export type CheckboxSize = 'sm' | 'md';

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  /** sm 16px / md 18px (기본 md) */
  size?: CheckboxSize;
  /** 감싸는 span(상자 크기 기준)의 클래스 */
  wrapperClassName?: string;
  ref?: Ref<HTMLInputElement>;
};

export type CheckboxProps = BaseProps & {
  /** 일부 선택(가로선) — 네이티브 `indeterminate` 속성으로 반영(체크 여부와 별개, 표시는 가로선이 우선) */
  indeterminate?: boolean;
};

export type RadioProps = BaseProps;

const BOX_SIZE: Record<CheckboxSize, string> = { sm: 'size-4', md: 'size-[18px]' };

/** 상자·원 공통 — 테두리·hover·checked·focus-visible·disabled */
const CONTROL_CLASS = cn(
  'peer m-0 block size-full shrink-0 cursor-pointer appearance-none border-[1.5px] border-solid border-neutral-600 bg-neutral-0 p-0 transition-colors',
  'enabled:hover:not-checked:not-indeterminate:border-neutral-900 enabled:hover:not-checked:not-indeterminate:bg-neutral-50',
  'checked:border-primary-600 checked:bg-primary-600 indeterminate:border-primary-600 indeterminate:bg-primary-600',
  FOCUS_RING_CLASSES,
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/** 체크 표시(✓) — 12×12 기준 선 */
export function CheckMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path
        d="M2.5 6.2 4.9 8.6 9.5 3.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 가로선(−) — indeterminate */
export function MinusMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M3 6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const MARK_CLASS =
  'pointer-events-none absolute inset-0 m-auto size-[75%] text-white peer-disabled:opacity-50';

export function Checkbox({
  size = 'md',
  indeterminate = false,
  className,
  wrapperClassName,
  ref,
  ...props
}: CheckboxProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);

  // indeterminate 는 HTML 속성이 없어 DOM 속성으로만 반영된다
  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const setRef = (node: HTMLInputElement | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <span
      data-checkbox=""
      className={cn('relative inline-flex shrink-0', BOX_SIZE[size], wrapperClassName)}
    >
      <input
        ref={setRef}
        type="checkbox"
        className={cn(CONTROL_CLASS, 'rounded-[4px]', className)}
        {...props}
      />
      <CheckMark
        className={cn(MARK_CLASS, 'hidden peer-checked:block peer-indeterminate:hidden')}
      />
      <MinusMark className={cn(MARK_CLASS, 'hidden peer-indeterminate:block')} />
    </span>
  );
}

export function Radio({ size = 'md', className, wrapperClassName, ref, ...props }: RadioProps) {
  return (
    <span
      data-radio=""
      className={cn('relative inline-flex shrink-0', BOX_SIZE[size], wrapperClassName)}
    >
      <input
        ref={ref}
        type="radio"
        className={cn(CONTROL_CLASS, 'rounded-full', className)}
        {...props}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto hidden size-2 rounded-full bg-white peer-checked:block peer-disabled:opacity-50"
      />
    </span>
  );
}
