import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type PillTone = 'neutral' | 'positive' | 'purple' | 'amber' | 'red';

export type PillProps = HTMLAttributes<HTMLSpanElement> & { tone?: PillTone };

const TONE_CLASSES: Record<PillTone, string> = {
  neutral: 'bg-gray-100 text-text-secondary',
  positive: 'bg-green-600/12 text-green-600',
  purple: 'bg-purple-500/12 text-purple-500',
  amber: 'bg-amber-500/15 text-amber-500',
  red: 'bg-red-500/12 text-red-500',
};

/** 상태·분류 표시용 필(배지). 색상은 의미별 tone 으로 선택 */
export function Pill({ tone = 'neutral', className, ...props }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-2.5 py-1 text-[12px] font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}
