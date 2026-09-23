import type { IconName } from './icons';

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: IconName;
};

/** 일반 메뉴 (디자인 navMain 순서 유지) */
export const NAV_MAIN: readonly NavItem[] = [
  { key: 'home', label: 'HOME', href: '/', icon: 'home' },
  { key: 'pricing', label: '가격 정책 조회', href: '/pricing', icon: 'tag' },
  { key: 'calculator', label: '계산기', href: '/calculator', icon: 'calc' },
];

/**
 * 관리자 메뉴 (디자인 navAdmin 순서 유지).
 * 디자인의 "보기 권한" 역할 토글은 제거했다. 실제 역할 기반 노출은 PR-2(인증·RBAC)에서 세션으로 결정한다.
 */
export const NAV_ADMIN: readonly NavItem[] = [
  { key: 'admin-policies', label: '가격정책 관리', href: '/admin/policies', icon: 'shield' },
  { key: 'admin-costs', label: '원가 관리', href: '/admin/costs', icon: 'box' },
  { key: 'admin-parts', label: '파츠 관리', href: '/admin/parts', icon: 'box' },
  { key: 'admin-groups', label: '솔루션 그룹 관리', href: '/admin/groups', icon: 'group' },
  { key: 'admin-users', label: '사용자 · 권한', href: '/admin/users', icon: 'users' },
  { key: 'admin-notices', label: '공지사항 관리', href: '/admin/notices', icon: 'tag' },
  { key: 'admin-audit', label: '감사 로그', href: '/admin/audit', icon: 'log' },
];

/** 현재 경로가 메뉴 항목에 해당하는지 판정한다. 루트는 정확히 일치, 그 외는 하위 경로까지 포함 */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
