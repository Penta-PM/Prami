import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type PillTone = 'neutral' | 'positive' | 'purple' | 'amber' | 'red';

export type PillProps = HTMLAttributes<HTMLSpanElement> & { tone?: PillTone };

const TONE_CLASSES: Record<PillTone, string> = {
  neutral: 'bg-gray-100 text-text-secondary',
  positive: 'bg-green-600/12 text-green-700',
  purple: 'bg-purple-500/12 text-purple-600',
  // 글자 amber-700: amber-500 은 15% 앰버 배경에서 1.9:1 (BL-1 — 상태 필 대비, '비활성'·'중요'와 같은 처방)
  amber: 'bg-amber-500/15 text-amber-700',
  // 글자 red-600: red-500 은 옅은 빨강 배경에서 3.7:1 로 AA 미달(사용자 표 '비활성', A-1 QA 백로그 — 중요 배지 #54 와 같은 처방)
  red: 'bg-red-500/12 text-red-600',
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
