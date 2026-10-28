/**
 * Penta L1 색 원시값의 JS 상수 (Penta 디자인 PR-5). CSS 변수를 쓸 수 없는 곳 — React-PDF 견적서(QuotePdf) 등 — 전용.
 * 화면 코드는 이 상수 대신 CSS 토큰(bg-primary-600·text-text-secondary·var(--…))을 쓴다.
 *
 * 값은 src/app/globals.css 첫 :root 의 `--penta-<이름>` 과 반드시 같아야 한다 — tests/unit/design/penta-colors.test.ts 가
 * 모든 키를 대조한다(한쪽만 바꾸면 실패). 키 = `--penta-` 뒤 이름.
 */
export const PENTA_COLORS = {
  'primary-50': '#ebf2ff',
  'primary-100': '#c2d9ff',
  'primary-200': '#93c5fd',
  'primary-300': '#60a5fa',
  'primary-400': '#3b82f6',
  'primary-500': '#1e6fff',
  'primary-600': '#1858cc',
  'primary-700': '#124199',
  'primary-800': '#1e3a8a',
  'primary-900': '#061433',
  'neutral-0': '#ffffff',
  'neutral-50': '#f7f8fa',
  'neutral-100': '#eceef2',
  'neutral-200': '#d9dce3',
  'neutral-300': '#d1d5db',
  'neutral-400': '#9aa1b0',
  'neutral-500': '#6b7280',
  'neutral-600': '#545d70',
  'neutral-700': '#374151',
  'neutral-800': '#1f2937',
  'neutral-900': '#111620',
  'success-50': '#f0fdf4',
  'success-500': '#22c55e',
  'success-700': '#15803d',
  'success-800': '#166534',
  'warning-50': '#fffbeb',
  'warning-500': '#f59e0b',
  'warning-700': '#b45309',
  'warning-800': '#92400e',
  'error-50': '#fef2f2',
  'error-500': '#ef4444',
  'error-700': '#b91c1c',
  'info-50': '#eff6ff',
  'info-500': '#3b82f6',
  'info-700': '#1d4ed8',
} as const;

export type PentaColorName = keyof typeof PENTA_COLORS;
