import type { SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/** 네이티브 select. Input 과 같은 회색 배경 + hairline 스타일 */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full rounded-xl border-0 bg-gray-75 py-2.5 pr-8 pl-3.5 text-[13px] text-ink-900 shadow-(--hairline-default) outline-none',
        'focus-visible:shadow-[inset_0_0_0_1px_var(--purple-500)]',
        className,
      )}
      {...props}
    />
  );
}
