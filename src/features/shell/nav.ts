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

/** 일반 메뉴 */
export const NAV_MAIN: readonly NavItem[] = [
  { key: 'home', label: 'HOME', href: '/', icon: 'home' },
];

/**
 * 가격 정책 메뉴 (UX PR-U1 §1 — "조달" 섹션과 같은 방식). 사이드바 "가격 정책" 섹션. URL·page-state 키는 그대로다.
 * `/pricing` 은 exact — 같은 섹션의 챗봇 경로 `/pricing/chat` 에서 함께 활성되지 않게 한다.
 * "가격 정책 챗봇"(UX PR-C2, Q-U2 A)은 chat.use — 헤더 챗봇 버튼을 대신하는 진입점.
 */
export const NAV_PRICING: readonly NavItem[] = [
  {
    key: 'pricing',
    label: '가격 정책 조회',
    href: '/pricing',
    icon: 'tag',
    permission: 'pricing.read',
    exact: true,
  },
  {
    key: 'calculator',
    label: '계산기',
    href: '/calculator',
    icon: 'calculator',
    permission: 'calculator.use',
  },
  {
    key: 'pricing-chat',
    label: '가격 정책 챗봇',
    href: '/pricing/chat',
    icon: 'message',
    permission: 'chat.use',
  },
];

/**
 * 조달 메뉴 (조달이 통합 UI-1, procurement.read = USER·ADMIN — D-1). 사이드바 "조달" 섹션.
 * "조달 챗봇"(UX PR-C2, Q-U2 A)은 섹션 권한 procurement.read 에 더해 chat.use 가 있어야 보인다(항목 permission = chat.use).
 */
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
  {
    key: 'procurement-chat',
    label: '조달 챗봇',
    href: '/procurement/chat',
    icon: 'message',
    permission: 'chat.use',
  },
];

/**
 * 관리자 메뉴 (디자인 navAdmin 순서 유지).
 * 디자인의 "보기 권한" 역할 토글은 제거했다. 실제 역할 기반 노출은 PR-2(인증·RBAC)에서 세션으로 결정한다.
 */
export const NAV_ADMIN: readonly NavItem[] = [
  { key: 'admin-policies', label: '가격정책 관리', href: '/admin/policies', icon: 'file-edit' },
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
  /** 가격 정책 섹션의 "가격 정책 조회" (pricing.read) */
  showPricingNav: boolean;
  /** 가격 정책 섹션의 "계산기" (calculator.use) */
  showCalculatorNav: boolean;
  /** 관리자 섹션 (관리자 영역 = users.manage) */
  showAdminNav: boolean;
  /** 챗봇 메뉴 — 가격 정책 챗봇·조달 챗봇 (chat.use, UX PR-C2). 조달 챗봇은 조달 섹션(procurement.read) 안에서만 */
  showChatNav: boolean;
  /** 조달 섹션 (procurement.read) */
  showProcurementNav: boolean;
  /** 관리자 섹션의 "조달 관리" (procurement.write — D-2) */
  showProcurementAdminNav: boolean;
};

export function navVisibility(role: Role | null | undefined): NavVisibility {
  return {
    showPricingNav: hasPermission(role, 'pricing.read'),
    showCalculatorNav: hasPermission(role, 'calculator.use'),
    showChatNav: hasPermission(role, 'chat.use'),
    showAdminNav: hasPermission(role, 'users.manage'),
    showProcurementNav: hasPermission(role, 'procurement.read'),
    showProcurementAdminNav: hasPermission(role, 'procurement.write'),
  };
}

/** 가격 정책 섹션 항목 — 항목마다 그 권한 노출 값으로 거른다(빈 배열이면 섹션 머리도 그리지 않는다) */
export function pricingNavItems(
  visibility: Pick<NavVisibility, 'showPricingNav' | 'showCalculatorNav' | 'showChatNav'>,
): readonly NavItem[] {
  return NAV_PRICING.filter((item) => {
    if (item.permission === 'calculator.use') return visibility.showCalculatorNav;
    if (item.permission === 'chat.use') return visibility.showChatNav;
    return visibility.showPricingNav;
  });
}

/** 조달 섹션 항목 — 섹션 자체는 procurement.read(showProcurementNav) 일 때만, 조달 챗봇은 chat.use 도 있어야 한다 */
export function getProcurementNavItems(
  visibility: Pick<NavVisibility, 'showProcurementNav' | 'showChatNav'>,
): readonly NavItem[] {
  if (!visibility.showProcurementNav) return [];
  return NAV_PROCUREMENT.filter((item) => item.permission !== 'chat.use' || visibility.showChatNav);
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
