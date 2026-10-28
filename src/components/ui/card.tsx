import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/** 카드 표면 (Penta §6 Card): N0 바탕 · 1px N100 테두리 · 반경 12 · 그림자 md · 안쪽 여백 20 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-card border border-solid border-neutral-100 bg-neutral-0 p-5 shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('m-0 [font:var(--text-h2)]', className)} {...props} />;
}
