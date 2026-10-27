import { describe, expect, it } from 'vitest';

import {
  adminItemsFilterToQuery,
  adminItemsHref,
  DEFAULT_ADMIN_ITEMS_FILTER,
  nextAdminItemSort,
  normalizeAdminItemsQuery,
  parseAdminItemsFilter,
} from '@/lib/procurement/admin-items-filter';

/** 조달이 통합 UI-7 — 품목 관리 URL 조건 코덱·조회 상태 정규화 (화면·저장이 같은 함수) */
describe('parseAdminItemsFilter', () => {
  it('빈 값 = 기본 (등록일자 최신순, 1페이지)', () => {
    expect(parseAdminItemsFilter({})).toEqual(DEFAULT_ADMIN_ITEMS_FILTER);
    expect(parseAdminItemsFilter(new URLSearchParams('tab=items'))).toEqual(
      DEFAULT_ADMIN_ITEMS_FILTER,
    );
  });

  it('모든 키를 읽는다 (URLSearchParams·searchParams 객체 모두)', () => {
    const expected = {
      q: '가상',
      product: '기타',
      page: 3,
      trashPage: 2,
      sort: { id: 'manufacturer', dir: 'desc' },
    };
    expect(
      parseAdminItemsFilter({
        tab: 'items',
        q: '  가상 ',
        product: '기타',
        page: '3',
        trashPage: ['2', '9'],
        sort: 'manufacturer',
        dir: 'desc',
      }),
    ).toEqual(expected);
    expect(
      parseAdminItemsFilter(
        new URLSearchParams('q=가상&product=기타&page=3&trashPage=2&sort=manufacturer&dir=desc'),
      ),
    ).toEqual(expected);
  });

  it('모르는 값·조작된 값은 기본값 (제품·페이지·정렬 화이트리스트, 검색어 100자)', () => {
    const filter = parseAdminItemsFilter({
      q: 'x'.repeat(150),
      product: 'NOPE',
      page: '0',
      trashPage: '99999999',
      sort: 'unitPrice',
      dir: 'sideways',
    });
    expect(filter).toEqual({ ...DEFAULT_ADMIN_ITEMS_FILTER, q: 'x'.repeat(100) });
    expect(parseAdminItemsFilter({ sort: 'itemId', dir: 'weird' }).sort).toEqual({
      id: 'itemId',
      dir: 'asc',
    });
    expect(parseAdminItemsFilter({ page: '2.5' }).page).toBe(1);
  });
});

describe('adminItemsFilterToQuery · adminItemsHref', () => {
  it('항상 tab=items, 기본값 생략, 키 순서 고정(sort·dir 맨 뒤)', () => {
    expect(adminItemsFilterToQuery({})).toBe('?tab=items');
    expect(adminItemsFilterToQuery(DEFAULT_ADMIN_ITEMS_FILTER)).toBe('?tab=items');
    expect(
      adminItemsFilterToQuery({
        sort: { id: 'itemId', dir: 'desc' },
        trashPage: 2,
        page: 4,
        product: 'iSIGN',
        q: ' 가 상 ',
      }),
    ).toBe(
      `?tab=items&q=${encodeURIComponent('가 상').replace(/%20/g, '+')}&product=iSIGN&page=4&trashPage=2&sort=itemId&dir=desc`,
    );
    expect(adminItemsHref({ page: 2 })).toBe('/admin/procurement?tab=items&page=2');
  });

  it('왕복: 직렬화 → 파싱 = 원래 조건', () => {
    const filter = {
      q: '가상 품목',
      product: 'D.AMO',
      page: 5,
      trashPage: 3,
      sort: { id: 'registeredOn' as const, dir: 'asc' as const },
    };
    expect(parseAdminItemsFilter(new URLSearchParams(adminItemsFilterToQuery(filter)))).toEqual(
      filter,
    );
  });
});

describe('normalizeAdminItemsQuery (page_key admin-procurement, items 탭)', () => {
  it("'?' 없이 tab=items 로 시작, 화이트리스트 밖 키·값은 사라진다", () => {
    expect(normalizeAdminItemsQuery({ tab: 'items' })).toBe('tab=items');
    expect(
      normalizeAdminItemsQuery({
        tab: 'items',
        sort: 'product',
        dir: 'desc',
        evil: '1',
        product: 'WAPPLES',
        page: '2',
        q: '',
      }),
    ).toBe('tab=items&product=WAPPLES&page=2&sort=product&dir=desc');
  });

  it('정규화는 멱등', () => {
    const once = normalizeAdminItemsQuery(new URLSearchParams('q=a&trashPage=2&sort=itemName'));
    expect(normalizeAdminItemsQuery(new URLSearchParams(once))).toBe(once);
    expect(once).toBe('tab=items&q=a&trashPage=2&sort=itemName&dir=asc');
  });
});

describe('nextAdminItemSort', () => {
  it('같은 열: 오름 → 내림 → 오름, 다른 열: 오름부터', () => {
    expect(nextAdminItemSort(null, 'itemId')).toEqual({ id: 'itemId', dir: 'asc' });
    expect(nextAdminItemSort({ id: 'itemId', dir: 'asc' }, 'itemId')).toEqual({
      id: 'itemId',
      dir: 'desc',
    });
    expect(nextAdminItemSort({ id: 'itemId', dir: 'desc' }, 'itemId')).toEqual({
      id: 'itemId',
      dir: 'asc',
    });
    expect(nextAdminItemSort({ id: 'itemId', dir: 'desc' }, 'product')).toEqual({
      id: 'product',
      dir: 'asc',
    });
  });
});
