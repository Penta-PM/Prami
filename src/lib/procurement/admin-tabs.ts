/**
 * 조달 관리(`/admin/procurement`) 탭 (조달이 통합 D-2 — 관리자 메뉴 1개 + 탭 3). 순수 모듈 — 화면·조회 상태 정규화 공용.
 * URL `?tab=` 값. 기본 탭(실적 관리)은 URL 에서 생략한다.
 */
export const PROCUREMENT_ADMIN_TABS = [
  { value: 'deliveries', label: '실적 관리' },
  { value: 'items', label: '품목 관리' },
  { value: 'keywords', label: '키워드 관리' },
] as const;

export type ProcurementAdminTab = (typeof PROCUREMENT_ADMIN_TABS)[number]['value'];

export const DEFAULT_PROCUREMENT_ADMIN_TAB: ProcurementAdminTab = 'deliveries';

export function isProcurementAdminTab(value: unknown): value is ProcurementAdminTab {
  return PROCUREMENT_ADMIN_TABS.some((tab) => tab.value === value);
}

/** URL 값 → 화면 탭 (모르는 값·없음 = 기본 탭) */
export function parseProcurementAdminTab(value: unknown): ProcurementAdminTab {
  return isProcurementAdminTab(value) ? value : DEFAULT_PROCUREMENT_ADMIN_TAB;
}

/** 저장·URL 용: 기본 탭·모르는 값은 null(생략) */
export function normalizeProcurementAdminTab(value: unknown): ProcurementAdminTab | null {
  const tab = parseProcurementAdminTab(value);
  return tab === DEFAULT_PROCUREMENT_ADMIN_TAB ? null : tab;
}
