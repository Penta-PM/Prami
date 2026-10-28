import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * globals.css @theme 의 앱 전용 반경·그림자 이름 — tailwind-merge 가 기본 크기 이름(sm·lg …)만 알아
 * `rounded-card` 와 `rounded-2xl` 를 충돌로 보지 않던 것을 같은 그룹으로 묶는다 (Penta 디자인 PR-2)
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['pill', 'circle', 'chip', 'control', 'card', 'modal'],
      shadow: ['dropdown', 'card', 'modal', 'panel'],
    },
  },
});

/** Tailwind 클래스 병합 유틸. 조건부 클래스와 충돌 클래스(뒤가 우선)를 정리한다. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
