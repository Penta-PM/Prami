import { describe, expect, it } from 'vitest';

import { NAV_ADMIN, NAV_MAIN, isNavActive } from '@/features/shell/nav';

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
});

describe('메뉴 정의', () => {
  const all = [...NAV_MAIN, ...NAV_ADMIN];

  it('디자인 순서의 일반 3개, 관리자 7개 메뉴를 가진다', () => {
    expect(NAV_MAIN.map((item) => item.label)).toEqual(['HOME', '가격 정책 조회', '계산기']);
    expect(NAV_ADMIN.map((item) => item.label)).toEqual([
      '가격정책 관리',
      '원가 관리',
      '파츠 관리',
      '솔루션 그룹 관리',
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
