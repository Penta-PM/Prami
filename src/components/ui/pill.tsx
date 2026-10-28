import type { HTMLAttributes } from 'react';

import { Icon } from '@/features/shell/icons';
import { cn } from '@/lib/cn';

/**
 * Status Badge 4종(success·warning·error·info) + 중립(neutral)·브랜드(primary).
 * 옛 이름(positive·amber·red·purple)은 기존 호출부 호환용 별칭 — 각각 success·warning·error·primary 와 같은 모양이다.
 */
export type StatusTone = 'success' | 'warning' | 'error' | 'info';
export type PillTone =
  | StatusTone
  | 'neutral'
  | 'primary'
  // 옛 이름(별칭) — 새 코드는 위 이름을 쓴다
  | 'positive'
  | 'amber'
  | 'red'
  | 'purple';

export type PillProps = HTMLAttributes<HTMLSpanElement> & { tone?: PillTone };

/** Penta §6 Status Badge: X50 바탕 + X700 글자 (전부 4.5:1 이상 — tests/unit/tokens.test.ts·ui/penta-components.test.tsx) */
const TONE_CLASSES: Record<PillTone, string> = {
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  error: 'bg-error-50 text-error-700',
  // Info 700 은 Primary 600 과 거의 같은 색(1.2:1) — 색만으로 구분되지 않게 아이콘을 함께 그린다
  info: 'bg-info-50 text-info-700',
  neutral: 'bg-neutral-100 text-neutral-700',
  primary: 'bg-primary-50 text-primary-700',
  positive: 'bg-success-50 text-success-700',
  amber: 'bg-warning-50 text-warning-700',
  red: 'bg-error-50 text-error-700',
  purple: 'bg-primary-50 text-primary-700',
};

/** 상태·분류 표시용 배지 (Penta §6 Status Badge): 높이 28 · 좌우 8 · 반경 full · Label 12 SemiBold */
export function Pill({ tone = 'neutral', className, children, ...props }: PillProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-pill px-2 text-[12px] leading-4 font-semibold whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {tone === 'info' ? <Icon name="info" width={14} height={14} className="shrink-0" /> : null}
      {children}
    </span>
  );
}
