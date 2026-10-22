import { cn } from '@/lib/cn';

/**
 * 칩 버튼 클래스 (디자인 토큰만 — 라이트·다크 공통). 가격 날짜 퀵칩(DateFilter)과 표 열 필터 바이 같이 쓴다.
 * active = 선택된 칩(잉크 배경).
 */
export function chipClass(active: boolean) {
  return cn(
    'rounded-pill border-0 px-3 py-[7px] text-[12px] font-semibold whitespace-nowrap',
    active
      ? 'bg-ink-900 text-white'
      : 'bg-surface-card text-text-secondary shadow-(--hairline-default) hover:text-ink-900',
  );
}
