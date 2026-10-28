import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** React 19 — 함수 컴포넌트도 ref 를 prop 으로 받는다 (팝오버 트리거 등) */
  ref?: Ref<HTMLButtonElement>;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-action-bg text-action-fg hover:bg-action-bg-hover',
  secondary:
    'bg-gray-75 text-text-secondary shadow-(--hairline-subtle) hover:bg-gray-100 hover:text-ink-900',
  ghost: 'bg-transparent text-text-secondary hover:bg-gray-100 hover:text-ink-900',
  danger: 'bg-danger-bg text-white hover:opacity-90',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12px]',
  md: 'h-10 px-4 text-[14px]',
};

/**
 * press 피드백 (Motion 도입 스펙 §3.3 P1): CSS 로만 scale 0.98 — Motion 을 쓰지 않아 서버 컴포넌트에서도 렌더된다
 * ("use client" 금지). Tailwind 4 의 scale-* 는 `scale` 속성이라 transition 대상·모션 감소 해제도 `scale` 로 맞춘다.
 */
export const PRESS_CLASSES =
  'transition-[color,background-color,border-color,opacity,scale] duration-120 active:scale-[0.98] motion-reduce:active:scale-100';

/** 디자인 시스템 버튼. 기본은 secondary(회색 hairline), 주요 행동은 primary(Penta --action-bg + 흰 글자 6.35:1) */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg border-0 font-semibold whitespace-nowrap',
        PRESS_CLASSES,
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}
