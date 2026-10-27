import { describe, expect, it } from 'vitest';

import {
  NAV_ADMIN,
  NAV_MAIN,
  NAV_PROCUREMENT,
  adminNavItems,
  isNavActive,
  navVisibility,
} from '@/features/shell/nav';

describe('isNavActive', () => {
  it('루트는 정확히 일치할 때만 활성이다', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/pricing', '/')).toBe(false);
  });

  it('하위 경로도 상위 메뉴를 활성으로 본다', () => {
    expect(isNavActive('/admin/policies', '/admin/policies')).toBe(true);
    expect(isNavActive('/admin/policies/123', '/admin/policies')).toBe(true);
  });

  it('접두만 같은 다른 경로는 활성이 아니다', () => {
    expect(isNavActive('/pricing-extra', '/pricing')).toBe(false);
    expect(isNavActive('/admin/notices', '/notices')).toBe(false);
  });

  it('exact 항목은 하위 경로에서 활성이 아니다 (조달 실적 현황 vs 등록 품목)', () => {
    expect(isNavActive('/procurement', '/procurement', true)).toBe(true);
    expect(isNavActive('/procurement/items', '/procurement', true)).toBe(false);
    expect(isNavActive('/procurement/items', '/procurement/items')).toBe(true);
  });
});

describe('메뉴 정의', () => {
  const all = [...NAV_MAIN, ...NAV_PROCUREMENT, ...NAV_ADMIN];

  it('디자인 순서의 일반 3개, 조달 3개, 관리자 8개 메뉴를 가진다', () => {
    expect(NAV_MAIN.map((item) => item.label)).toEqual(['HOME', '가격 정책 조회', '계산기']);
    expect(NAV_PROCUREMENT.map((item) => [item.label, item.href])).toEqual([
      ['조달 실적 현황', '/procurement'],
      ['등록 품목', '/procurement/items'],
      ['입찰 공고', '/procurement/bids'],
    ]);
    expect(NAV_ADMIN.map((item) => item.label)).toEqual([
      '가격정책 관리',
      '원가 관리',
      '파츠 관리',
      '솔루션 그룹 관리',
      '조달 관리',
      '사용자 · 권한',
      '공지사항 관리',
      '감사 로그',
    ]);
  });

  it('key 와 href 는 중복되지 않는다', () => {
    expect(new Set(all.map((item) => item.key)).size).toBe(all.length);
    expect(new Set(all.map((item) => item.href)).size).toBe(all.length);
  });

  it('관리자 메뉴는 /admin 아래에 있다', () => {
    for (const item of NAV_ADMIN) expect(item.href.startsWith('/admin/')).toBe(true);
  });
});

describe('메뉴 노출 (조달이 통합 UI-1 — D-1·D-2)', () => {
  it('USER: 조달 섹션만, 관리자·조달 관리 없음', () => {
    expect(navVisibility('USER')).toEqual({
      showAdminNav: false,
      showProcurementNav: true,
      showProcurementAdminNav: false,
    });
  });

  it('ADMIN: 조달 섹션 + 관리자 섹션의 조달 관리', () => {
    const visibility = navVisibility('ADMIN');
    expect(visibility).toEqual({
      showAdminNav: true,
      showProcurementNav: true,
      showProcurementAdminNav: true,
    });
    expect(adminNavItems(visibility).map((item) => item.href)).toContain('/admin/procurement');
  });

  it('역할 없음(권한 없음): 조달·관리자 모두 숨김', () => {
    expect(navVisibility(null)).toEqual({
      showAdminNav: false,
      showProcurementNav: false,
      showProcurementAdminNav: false,
    });
  });

  it('procurement.write 가 없으면 관리자 섹션에서 조달 관리만 빠진다', () => {
    const items = adminNavItems({ showProcurementAdminNav: false });
    expect(items.map((item) => item.label)).not.toContain('조달 관리');
    expect(items).toHaveLength(NAV_ADMIN.length - 1);
  });

  it('조달 메뉴는 procurement.read, 조달 관리는 procurement.write 로 표시한다', () => {
    for (const item of NAV_PROCUREMENT) expect(item.permission).toBe('procurement.read');
    expect(NAV_ADMIN.find((item) => item.key === 'admin-procurement')?.permission).toBe(
      'procurement.write',
    );
  });
});
