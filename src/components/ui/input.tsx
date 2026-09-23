import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** 입력창 왼쪽에 겹쳐 표시할 아이콘 */
  leading?: ReactNode;
  wrapperClassName?: string;
};

/** 텍스트 입력. 헤더 검색창과 동일한 회색 배경 + hairline 스타일 */
export function Input({ leading, className, wrapperClassName, ...props }: InputProps) {
  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      {leading ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 flex -translate-y-1/2 text-text-tertiary"
        >
          {leading}
        </span>
      ) : null}
      <input
        className={cn(
          'w-full rounded-xl border-0 bg-gray-75 py-2.5 pr-3.5 text-[13px] text-ink-900 shadow-(--hairline-default) outline-none',
          'placeholder:text-text-tertiary focus-visible:shadow-[inset_0_0_0_1px_var(--purple-500)]',
          leading ? 'pl-10' : 'pl-3.5',
          className,
        )}
        {...props}
      />
    </div>
  );
}
