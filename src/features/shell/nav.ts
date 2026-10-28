import { hasPermission, type PermissionKey, type Role } from '@/lib/constants/permissions';

import type { NavIconName } from './icons';

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: NavIconName;
  /** 이 권한이 있어야 메뉴를 보인다(표시용 — 실제 차단은 각 화면 가드). 없으면 섹션 노출 규칙만 따른다 */
  permission?: PermissionKey;
  /** 하위 경로에서는 활성으로 보지 않는다 — `/procurement` 는 `/procurement/items` 에서 활성이 아니다 */
  exact?: boolean;
};

/** 일반 메뉴 (디자인 navMain 순서 유지) */
export const NAV_MAIN: readonly NavItem[] = [
  { key: 'home', label: 'HOME', href: '/', icon: 'home' },
  { key: 'pricing', label: '가격 정책 조회', href: '/pricing', icon: 'tag' },
  { key: 'calculator', label: '계산기', href: '/calculator', icon: 'calculator' },
];

/** 조달 메뉴 (조달이 통합 UI-1, procurement.read = USER·ADMIN — D-1). 사이드바 "조달" 섹션 */
export const NAV_PROCUREMENT: readonly NavItem[] = [
  {
    key: 'procurement',
    label: '조달 실적 현황',
    href: '/procurement',
    icon: 'chart-line',
    permission: 'procurement.read',
    exact: true,
  },
  {
    key: 'procurement-items',
    label: '등록 품목',
    href: '/procurement/items',
    icon: 'list',
    permission: 'procurement.read',
  },
  {
    key: 'procurement-bids',
    label: '입찰 공고',
    href: '/procurement/bids',
    icon: 'file-text',
    permission: 'procurement.read',
  },
];

/**
 * 관리자 메뉴 (디자인 navAdmin 순서 유지).
 * 디자인의 "보기 권한" 역할 토글은 제거했다. 실제 역할 기반 노출은 PR-2(인증·RBAC)에서 세션으로 결정한다.
 */
export const NAV_ADMIN: readonly NavItem[] = [
  { key: 'admin-policies', label: '가격정책 관리', href: '/admin/policies', icon: 'shield' },
  { key: 'admin-costs', label: '원가 관리', href: '/admin/costs', icon: 'won-note' },
  { key: 'admin-parts', label: '파츠 관리', href: '/admin/parts', icon: 'blocks-2' },
  { key: 'admin-groups', label: '솔루션 그룹 관리', href: '/admin/groups', icon: 'grid' },
  {
    key: 'admin-procurement',
    label: '조달 관리',
    href: '/admin/procurement',
    icon: 'cart',
    permission: 'procurement.write',
  },
  { key: 'admin-users', label: '사용자 · 권한', href: '/admin/users', icon: 'users' },
  { key: 'admin-notices', label: '공지사항 관리', href: '/admin/notices', icon: 'tag' },
  { key: 'admin-audit', label: '감사 로그', href: '/admin/audit', icon: 'file-log' },
];

/** 사이드바에 넘길 메뉴 노출 — 세션 역할로 결정한다(메뉴 숨김은 표시용, 직접 접근은 화면 가드가 막는다) */
export type NavVisibility = {
  /** 관리자 섹션 (관리자 영역 = users.manage) */
  showAdminNav: boolean;
  /** 조달 섹션 (procurement.read) */
  showProcurementNav: boolean;
  /** 관리자 섹션의 "조달 관리" (procurement.write — D-2) */
  showProcurementAdminNav: boolean;
};

export function navVisibility(role: Role | null | undefined): NavVisibility {
  return {
    showAdminNav: hasPermission(role, 'users.manage'),
    showProcurementNav: hasPermission(role, 'procurement.read'),
    showProcurementAdminNav: hasPermission(role, 'procurement.write'),
  };
}

/** 관리자 섹션 항목 — 권한이 걸린 항목(조달 관리)은 그 권한 노출 값으로 거른다 */
export function adminNavItems(
  visibility: Pick<NavVisibility, 'showProcurementAdminNav'>,
): readonly NavItem[] {
  return NAV_ADMIN.filter(
    (item) => item.permission !== 'procurement.write' || visibility.showProcurementAdminNav,
  );
}

/** 현재 경로가 메뉴 항목에 해당하는지 판정한다. 루트·exact 항목은 정확히 일치, 그 외는 하위 경로까지 포함 */
export function isNavActive(pathname: string, href: string, exact = false): boolean {
  if (href === '/' || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
