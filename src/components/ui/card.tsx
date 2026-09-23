import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/** 카드 표면. 디자인은 그림자 대신 1px inset hairline 으로 테두리를 그린다 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl bg-surface-card p-6 shadow-(--hairline-default)', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('m-0 [font:var(--text-h2)]', className)} {...props} />;
}
