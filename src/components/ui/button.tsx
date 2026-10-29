import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/cn';

import { controlSizeClasses, type ControlSize } from './density';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = ControlSize;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /**
   * sm 36·14 / md 44·16 / lg 52·16. 주지 않으면 가장 가까운 `data-density` 컨테이너를 따른다
   * (밀집 컨테이너 안 = sm, 그 밖·모달 = md — Q-D1 = B, ./density.tsx)
   */
  size?: ButtonSize;
  /** React 19 — 함수 컴포넌트도 ref 를 prop 으로 받는다 (팝오버 트리거 등) */
  ref?: Ref<HTMLButtonElement>;
};

/**
 * Penta §6 Button. 글자는 600/700(흰 바탕 AA), 500 은 쓰지 않는다 — Primary 채움 = --action-bg(P600, 흰 글자 6.35:1),
 * Secondary 글자·테두리 = P600, Danger = --danger-bg(Error700, 흰 글자 6.47:1), Ghost = N50 바탕·N700 글자·N200 테두리.
 * 모든 variant 가 1px 테두리를 가져(채움형은 투명) 높이·폭이 variant 와 무관하게 같다.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-action-bg text-action-fg hover:bg-action-bg-hover',
  secondary:
    'border-primary-600 bg-neutral-0 text-primary-600 hover:border-primary-700 hover:bg-primary-50 hover:text-primary-700',
  ghost:
    'border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900',
  danger: 'border-transparent bg-danger-bg text-text-inverse hover:opacity-90',
};

/**
 * press 피드백 (Motion 도입 스펙 §3.3 P1): CSS 로만 scale 0.98 — Motion 을 쓰지 않아 서버 컴포넌트에서도 렌더된다
 * ("use client" 금지). Tailwind 4 의 scale-* 는 `scale` 속성이라 transition 대상·모션 감소 해제도 `scale` 로 맞춘다.
 */
export const PRESS_CLASSES =
  'transition-[color,background-color,border-color,opacity,scale] duration-120 active:scale-[0.98] motion-reduce:active:scale-100';

/** 포커스 고리 — 모든 공용 컨트롤 공통(키보드 포커스에만, 2px --focus-ring(P500) + 2px 띄움) */
export const FOCUS_RING_CLASSES =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

/** 디자인 시스템 버튼. 기본은 secondary(흰 바탕 + P600 글자·테두리), 주요 행동은 primary(--action-bg + 흰 글자) */
export function Button({
  variant = 'secondary',
  size,
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control border border-solid px-4 font-semibold whitespace-nowrap',
        PRESS_CLASSES,
        FOCUS_RING_CLASSES,
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        controlSizeClasses(size),
        className,
      )}
      {...props}
    />
  );
}
