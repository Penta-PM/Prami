import { describe, expect, it } from 'vitest';

import {
  NAV_ADMIN,
  NAV_MAIN,
  NAV_PRICING,
  NAV_PROCUREMENT,
  adminNavItems,
  isNavActive,
  navVisibility,
  pricingNavItems,
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

  it('UX PR-U1: 가격 정책 조회(/pricing)는 exact — 챗봇 경로 /pricing/chat 에서 활성이 아니다', () => {
    const pricing = NAV_PRICING.find((item) => item.key === 'pricing')!;
    expect(pricing.exact).toBe(true);
    expect(isNavActive('/pricing', pricing.href, pricing.exact)).toBe(true);
    expect(isNavActive('/pricing/chat', pricing.href, pricing.exact)).toBe(false);
    const calculator = NAV_PRICING.find((item) => item.key === 'calculator')!;
    expect(isNavActive('/calculator', calculator.href, calculator.exact)).toBe(true);
    expect(isNavActive('/pricing/chat', calculator.href, calculator.exact)).toBe(false);
  });
});

describe('메뉴 정의', () => {
  const all = [...NAV_MAIN, ...NAV_PRICING, ...NAV_PROCUREMENT, ...NAV_ADMIN];

  it('일반 1개(HOME), 가격 정책 2개, 조달 3개, 관리자 8개 메뉴를 가진다 (UX PR-U1 — URL 그대로)', () => {
    expect(NAV_MAIN.map((item) => [item.label, item.href])).toEqual([['HOME', '/']]);
    expect(NAV_PRICING.map((item) => [item.label, item.href, item.icon])).toEqual([
      ['가격 정책 조회', '/pricing', 'tag'],
      ['계산기', '/calculator', 'calculator'],
    ]);
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
  it('USER: 가격 정책·조달 섹션, 관리자·조달 관리 없음', () => {
    expect(navVisibility('USER')).toEqual({
      showPricingNav: true,
      showCalculatorNav: true,
      showAdminNav: false,
      showProcurementNav: true,
      showProcurementAdminNav: false,
    });
  });

  it('ADMIN: 조달 섹션 + 관리자 섹션의 조달 관리', () => {
    const visibility = navVisibility('ADMIN');
    expect(visibility).toEqual({
      showPricingNav: true,
      showCalculatorNav: true,
      showAdminNav: true,
      showProcurementNav: true,
      showProcurementAdminNav: true,
    });
    expect(adminNavItems(visibility).map((item) => item.href)).toContain('/admin/procurement');
  });

  it('역할 없음(권한 없음): 가격 정책·조달·관리자 모두 숨김', () => {
    expect(navVisibility(null)).toEqual({
      showPricingNav: false,
      showCalculatorNav: false,
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

  it('가격 정책 섹션은 항목별 권한으로 거른다 (pricing.read·calculator.use)', () => {
    expect(NAV_PRICING.map((item) => item.permission)).toEqual(['pricing.read', 'calculator.use']);
    const keys = (showPricingNav: boolean, showCalculatorNav: boolean) =>
      pricingNavItems({ showPricingNav, showCalculatorNav }).map((item) => item.key);
    expect(keys(true, true)).toEqual(['pricing', 'calculator']);
    expect(keys(true, false)).toEqual(['pricing']);
    expect(keys(false, true)).toEqual(['calculator']);
    expect(keys(false, false)).toEqual([]);
  });

  it('조달 메뉴는 procurement.read, 조달 관리는 procurement.write 로 표시한다', () => {
    for (const item of NAV_PROCUREMENT) expect(item.permission).toBe('procurement.read');
    expect(NAV_ADMIN.find((item) => item.key === 'admin-procurement')?.permission).toBe(
      'procurement.write',
    );
  });
});
