import { cn } from '@/lib/cn';

import { FOCUS_RING_CLASSES } from './button';
import { CONTROL_SIZE_CLASSES } from './density';

/**
 * 칩 버튼 클래스 (디자인 토큰만). 가격 날짜 퀵칩(DateFilter)·표 빠른 필터 바·조달 필터 바가 같이 쓴다.
 * 칩은 필터 전용 컨트롤이라 놓인 자리와 관계없이 밀집 크기 sm(36·14)로 고정한다 (Q-D1 = B — 필터는 밀집).
 * active = 선택된 칩(반전 배경 --surface-inverse + --text-inverse).
 */
export function chipClass(active: boolean) {
  return cn(
    'inline-flex items-center rounded-pill border-0 px-3 font-semibold whitespace-nowrap',
    CONTROL_SIZE_CLASSES.sm,
    FOCUS_RING_CLASSES,
    active
      ? 'bg-surface-inverse text-text-inverse'
      : 'bg-surface-card text-text-secondary shadow-(--hairline-default) hover:text-text-primary',
  );
}
