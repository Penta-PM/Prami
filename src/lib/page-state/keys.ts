import type { PermissionKey } from '@/lib/constants/permissions';

/**
 * 조회 상태를 서버에 저장하는 화면 (page-state-memory §2.2-2) — 이 목록 밖의 키는 저장·복원하지 않는다.
 * 클라이언트(저장 트래커)·서버(저장 액션·RSC 복원) 공용 순수 모듈.
 */
export const PAGE_KEYS = [
  'pricing',
  'admin-policies',
  'admin-costs',
  'admin-audit',
  'admin-users',
  'admin-notices',
  'admin-parts',
  'calculator',
  'procurement',
  'procurement-items',
  'procurement-bids',
  'admin-procurement',
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/** 화면 경로 (복원 redirect 대상) */
export const PAGE_PATHS: Readonly<Record<PageKey, string>> = {
  pricing: '/pricing',
  'admin-policies': '/admin/policies',
  'admin-costs': '/admin/costs',
  'admin-audit': '/admin/audit',
  'admin-users': '/admin/users',
  'admin-notices': '/admin/notices',
  'admin-parts': '/admin/parts',
  calculator: '/calculator',
  procurement: '/procurement',
  'procurement-items': '/procurement/items',
  'procurement-bids': '/procurement/bids',
  'admin-procurement': '/admin/procurement',
};

/** 화면을 여는 권한 — 저장 액션도 같은 권한을 요구하고, 복원은 현재 권한으로 다시 판정한다(§2.7-1) */
export const PAGE_PERMISSIONS: Readonly<Record<PageKey, PermissionKey>> = {
  pricing: 'pricing.read',
  'admin-policies': 'pricing.write',
  'admin-costs': 'cost.read',
  'admin-audit': 'audit.read',
  'admin-users': 'users.manage',
  'admin-notices': 'notice.write',
  'admin-parts': 'parts.write',
  calculator: 'calculator.use',
  // 조달이 통합 UI-1 (D-1·D-2): 조회 화면 = procurement.read, 관리 화면 = procurement.write
  procurement: 'procurement.read',
  'procurement-items': 'procurement.read',
  'procurement-bids': 'procurement.read',
  'admin-procurement': 'procurement.write',
};

/** 저장 쿼리 최대 크기(UTF-8 바이트, §2.2-3) */
export const VIEW_QUERY_MAX_BYTES = 2048;

/** URL 변경 후 저장까지 기다리는 시간 (§2.2-3) */
export const VIEW_SAVE_DEBOUNCE_MS = 500;

export function isPageKey(value: unknown): value is PageKey {
  return typeof value === 'string' && (PAGE_KEYS as readonly string[]).includes(value);
}

/** UTF-8 바이트 수 (2KB 한도 판정) */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** '?a=b' · 'a=b' · '' → 'a=b' · '' (저장·비교 형식은 앞의 ? 없음) */
export function stripQueryPrefix(query: string): string {
  return query.startsWith('?') ? query.slice(1) : query;
}

/** 경로 + 쿼리 → href. 쿼리는 URLSearchParams 로 다시 조립해 인코딩을 맞춘다(§2.7-2) */
export function hrefWithQuery(path: string, query: string): string {
  const search = new URLSearchParams(stripQueryPrefix(query)).toString();
  return search ? `${path}?${search}` : path;
}

/** 앱 셸의 스크롤 컨테이너 `<main>` id — 스크롤 저장·복원 대상(§2.3-1, window 가 아님) */
export const APP_MAIN_ID = 'app-main';
