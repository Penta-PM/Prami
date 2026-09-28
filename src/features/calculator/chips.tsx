'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** 디자인의 선택 칩(제품·단가유형·분류·그룹) 공용 */
export function Chip({
  active,
  onClick,
  children,
  hint,
  className,
  ...rest
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-[10px] border-0 px-3 py-2.5 text-center text-[12px] font-semibold',
        active
          ? 'bg-ink-900 text-white'
          : 'bg-gray-75 text-text-secondary shadow-(--hairline-subtle) hover:text-ink-900',
        className,
      )}
      {...rest}
    >
      <span className="block">{children}</span>
      {hint ? <span className="block text-[11px] font-normal opacity-70">{hint}</span> : null}
    </button>
  );
}

/** STEP 카드 */
export function StepCard({
  title,
  children,
  'aria-label': ariaLabel,
}: {
  title: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  return (
    <section
      aria-label={ariaLabel ?? title}
      className="rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
    >
      <h2 className="m-0 mb-3.5 text-[13px] font-semibold text-text-tertiary">{title}</h2>
      {children}
    </section>
  );
}

/** 수량 −/+ */
export function QtyControl({
  value,
  onChange,
  label = '수량',
  size = 'md',
}: {
  value: number;
  onChange: (next: number) => void;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const btn = cn(
    'rounded-circle border-0 bg-gray-75 font-semibold shadow-(--hairline-default) hover:bg-gray-100',
    size === 'sm' ? 'size-[22px] text-[12px]' : 'size-8 text-[14px]',
  );
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label} 감소`}
        className={btn}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        −
      </button>
      <span
        aria-live="polite"
        className={cn(
          'text-center font-bold',
          size === 'sm' ? 'w-[18px] text-[12px]' : 'w-8 text-[16px]',
        )}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`${label} 증가`}
        className={btn}
        onClick={() => onChange(Math.min(9999, value + 1))}
      >
        +
      </button>
    </div>
  );
}
