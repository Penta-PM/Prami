import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  itemFilterDefs,
  itemsExportHref,
  itemsViewToQuery,
  ITEM_SORT_IDS,
  parseItemsView,
  toItemQueryFilter,
  type ItemsView,
} from '@/features/procurement/items/filter';
import type { ItemRowView } from '@/features/procurement/items/types';
import { stepValue, type MoneyRange } from '@/lib/table/money-range';

import {
  applyField,
  barFields,
  moreFields,
  openField,
  quickBar,
  range,
  toggleField,
} from '../table-filter/server-quick-helpers';

/**
 * 조달이 통합 UI-2 등록 품목 — URL 코덱(화이트리스트)·표(백만원 머리글·자사 강조)·빠른 필터 바(고정 제품·세부분류·제조사,
 * 계약단가 로그 슬라이더)·이동 방식(필터·검색 replace, 정렬·초기화 push)·내려받기 링크와 상한 안내. 합성 데이터만.
 */
const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }),
  usePathname: () => '/procurement/items',
}));

const { ItemsBrowser, OURS_ROW_CLASS } = await import('@/features/procurement/items/ItemsBrowser');
const { ItemsExportLink } = await import('@/features/procurement/items/ItemsExportLink');
const { ItemsPagination } = await import('@/features/procurement/items/ItemsPagination');

const CHOICES = {
  products: ['D.AMO', 'WAPPLES', 'iSIGN'],
  detailCategories: ['가상분류A', '가상분류B'],
  manufacturers: ['(주)펜타시큐리티', '가상보안'],
};
const DEFS = itemFilterDefs(CHOICES);

/** 합성 계약단가 범위 (원) */
const PRICE_RANGE: MoneyRange = {
  currency: 'KRW',
  min: 0,
  max: 480_000_000,
  minPositive: 1_200_000,
};

const ROWS: ItemRowView[] = [
  {
    id: 1,
    itemId: '90000001',
    product: 'WAPPLES',
    detailCategory: '가상분류A',
    manufacturer: '(주)펜타시큐리티',
    itemName: '가상 웹방화벽 1000',
    registeredOn: '2026-03-02',
    unitPrice: 123_456_789,
  },
  {
    id: 2,
    itemId: '90000002',
    product: 'D.AMO',
    detailCategory: null,
    manufacturer: '가상보안',
    itemName: null,
    registeredOn: null,
    unitPrice: null,
  },
];

const enc = (pairs: [string, string][]) => new URLSearchParams(pairs).toString();

const replacedAfter = (before: number) => () => mocks.replace.mock.calls.length > before;

const renderBrowser = (view: ItemsView = { page: 1 }, props: { total?: number } = {}) =>
  render(
    <ItemsBrowser
      rows={ROWS}
      view={view}
      total={props.total ?? 2}
      choices={CHOICES}
      priceRange={PRICE_RANGE}
      userId="u1"
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('등록 품목 URL 코덱', () => {
  it('정렬 화이트리스트는 조회 계층(PROCUREMENT_ITEM_SORT_IDS)과 같다', async () => {
    // 서버 모듈은 server-only 라 소스 문자열로 대조한다 (클라이언트 번들에 서버 모듈을 넣지 않기 위한 복제)
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/server/procurement/items.ts', 'utf8');
    const block = /PROCUREMENT_ITEM_SORT_IDS = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? '';
    expect([...block.matchAll(/'(\w+)'/g)].map((match) => match[1])).toEqual([...ITEM_SORT_IDS]);
  });

  it('왕복: q → f.*(필드 순) → page → sort·dir, 기본값·1페이지 생략', () => {
    const params = {
      dir: 'desc',
      sort: 'unitPrice',
      page: '3',
      'f.unitPrice.gte': '1000000',
      'f.manufacturer.in': '가상보안',
      'f.product.in': 'WAPPLES,iSIGN',
      'f.registeredOn.gte': '2026-01-01',
      q: '  가상 ',
    };
    const view = parseItemsView(params, DEFS);
    expect(view).toEqual({
      q: '가상',
      page: 3,
      sort: { id: 'unitPrice', dir: 'desc' },
      filters: [
        { col: 'registeredOn', op: 'gte', value: '2026-01-01' },
        { col: 'product', op: 'in', values: ['WAPPLES', 'iSIGN'] },
        { col: 'manufacturer', op: 'in', values: ['가상보안'] },
        { col: 'unitPrice', op: 'gte', value: '1000000' },
      ],
    });
    expect(itemsViewToQuery(view)).toBe(
      `?${enc([
        ['q', '가상'],
        ['f.registeredOn.gte', '2026-01-01'],
        ['f.product.in', 'WAPPLES,iSIGN'],
        ['f.manufacturer.in', '가상보안'],
        ['f.unitPrice.gte', '1000000'],
        ['page', '3'],
        ['sort', 'unitPrice'],
        ['dir', 'desc'],
      ])}`,
    );
    expect(itemsViewToQuery({ page: 1 })).toBe('');
  });

  it('화이트리스트 밖(모르는 열·연산자·선택지 밖 값·물품식별번호 열 필터·잘못된 정렬·제어 문자 검색)은 버린다', () => {
    const view = parseItemsView(
      {
        'f.itemId.has': '9000',
        'f.product.in': '없는제품',
        'f.manufacturer.eq': '가상보안',
        'f.unitPrice.gte': '1e9',
        'f.registeredOn.lte': '2026-02-30',
        sort: 'raw',
        page: '-1',
        q: 'a\u0000b',
        x: '1',
      },
      DEFS,
    );
    expect(view).toEqual({ page: 1 });
  });

  it('조회 필터로 변환: enum → 목록, 등록일자 → from/to, 계약단가 → 원 숫자', () => {
    const view = parseItemsView(
      {
        'f.registeredOn.gte': '2026-01-01',
        'f.registeredOn.lte': '2026-06-30',
        'f.product.in': 'WAPPLES',
        'f.detailCategory.in': '가상분류A,가상분류B',
        'f.manufacturer.in': '가상보안',
        'f.unitPrice.gte': '1200000',
        'f.unitPrice.lte': '4500000.5',
        q: '9000',
        sort: 'itemId',
      },
      DEFS,
    );
    expect(toItemQueryFilter(view)).toEqual({
      page: 1,
      q: '9000',
      sort: { id: 'itemId', dir: 'asc' },
      registeredFrom: '2026-01-01',
      registeredTo: '2026-06-30',
      products: ['WAPPLES'],
      detailCategories: ['가상분류A', '가상분류B'],
      manufacturers: ['가상보안'],
      priceMin: 1_200_000,
      priceMax: 4_500_000.5,
    });
  });

  it('내려받기 링크는 page 를 빼고 검색·필터·정렬을 그대로 싣는다', () => {
    expect(
      itemsExportHref({
        q: '가상',
        page: 4,
        sort: { id: 'product', dir: 'asc' },
        filters: [{ col: 'product', op: 'in', values: ['WAPPLES'] }],
      }),
    ).toBe(
      `/procurement/items/export?${enc([
        ['q', '가상'],
        ['f.product.in', 'WAPPLES'],
        ['sort', 'product'],
        ['dir', 'asc'],
      ])}`,
    );
  });
});

describe('등록 품목 표', () => {
  it('열 순서·계약단가 머리글 단위(백만원)·칸 백만원 소수 1자리(툴팁 억·만)·빈 값 —', () => {
    renderBrowser();
    const table = screen.getByRole('table', { name: '등록 품목 표' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim());
    expect(headers).toEqual([
      '등록일자',
      '제품',
      '세부분류',
      '제조사',
      '물품식별번호',
      '품목명',
      '계약단가 (백만원)',
    ]);
    const [, first, second] = within(table).getAllByRole('row');
    const price = within(first!).getByText('123.5');
    expect(price).toHaveAttribute('title', '1억 2,346만');
    expect(
      within(second!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['—', 'D.AMO', '—', '가상보안', '90000002', '—', '—']);
  });

  it('자사 제조사 행은 --accent-ours 강조 + "자사" 배지(색만으로 구분하지 않음), 다른 행은 강조 없음', () => {
    renderBrowser();
    const [, ours, other] = within(screen.getByRole('table')).getAllByRole('row');
    for (const name of OURS_ROW_CLASS.split(' ')) expect(ours).toHaveClass(name);
    expect(within(ours!).getByText('자사')).toHaveClass('text-accent-ours');
    expect(other!.className).not.toContain('accent-ours');
    expect(within(other!).queryByText('자사')).toBeNull();
  });

  it('데이터 없음 / 필터 결과 없음 빈 상태', async () => {
    const ue = userEvent.setup();
    const { unmount } = render(
      <ItemsBrowser rows={[]} view={{ page: 1 }} total={0} choices={CHOICES} userId="u1" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('등록된 품목이 없습니다');
    unmount();
    render(
      <ItemsBrowser
        rows={[]}
        view={{ page: 1, q: '없는품목' }}
        total={0}
        choices={CHOICES}
        userId="u1"
      />,
    );
    expect(screen.getByText('조건에 맞는 결과가 없습니다')).toBeInTheDocument();
    await ue.click(
      within(screen.getByText('조건에 맞는 결과가 없습니다').parentElement!).getByRole('button', {
        name: '필터 초기화',
      }),
    );
    expect(mocks.push).toHaveBeenLastCalledWith('/procurement/items');
  });

  it('표는 자기 상자 안에서만 가로 스크롤 (320px — 페이지 가로 스크롤 없음)', () => {
    renderBrowser();
    const box = screen.getByRole('table').closest('[data-procurement-items-scroll]');
    expect(box).not.toBeNull();
    expect(box).toHaveClass('max-w-full');
  });
});

describe('등록 품목 빠른 필터 바 (서버 모드)', () => {
  it('고정 = 제품·세부분류·제조사, ＋ 더 = 등록일자·계약단가, 바 오른쪽 총 건수', async () => {
    const ue = userEvent.setup();
    renderBrowser({ page: 1 }, { total: 1234 });
    expect(barFields()).toEqual(['제품', '세부분류', '제조사']);
    expect(await moreFields(ue)).toEqual(['등록일자', '계약단가']);
    expect(quickBar().querySelector('[data-quick-filter-count]')?.textContent).toBe('총 1234건');
  });

  it('제조사 체크 → 기존 검색·정렬 유지, page 제거, f.* 는 q 뒤·sort 맨 뒤 (replace 1회)', async () => {
    const ue = userEvent.setup();
    renderBrowser({ page: 3, q: '가상', sort: { id: 'unitPrice', dir: 'desc' } });
    await toggleField(ue, '제조사', ['가상보안'], replacedAfter(0));
    expect(mocks.replace.mock.calls).toEqual([
      [
        `/procurement/items?${enc([
          ['q', '가상'],
          ['f.manufacturer.in', '가상보안'],
        ])}&sort=unitPrice&dir=desc`,
      ],
    ]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('등록일자 범위 → f.registeredOn.gte·lte (replace)', async () => {
    const ue = userEvent.setup();
    renderBrowser({ page: 1, filters: [{ col: 'registeredOn', op: 'gte', value: '2026-01-01' }] });
    await applyField(ue, '등록일자', range(ue, null, '2026-06-30', 'date'));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      `/procurement/items?${enc([
        ['f.registeredOn.gte', '2026-01-01'],
        ['f.registeredOn.lte', '2026-06-30'],
      ])}`,
    );
  });

  it('계약단가 슬라이더: 통화 선택 없이 바로 로그 슬라이더(KRW 범위) — 양 끝 = 제한 없음, End = 실제 최대 → f.unitPrice.gte (원)', async () => {
    const ue = userEvent.setup();
    renderBrowser();
    const dialog = await openField(ue, '계약단가');
    expect(within(dialog).queryByRole('radio')).toBeNull();
    const lower = within(dialog).getByRole('slider', { name: '계약단가 최소' });
    const upper = within(dialog).getByRole('slider', { name: '계약단가 최대' });
    expect(lower).toHaveAttribute('aria-valuetext', '제한 없음');
    expect(upper).toHaveAttribute('aria-valuetext', '제한 없음');
    // 로그 눈금 경계: 칸 1 = 0 초과 최소, 칸 200 = 최대 (그 사이 유효숫자 2자리)
    expect(stepValue(1, 'lower', PRICE_RANGE)).toBe('1200000');
    expect(stepValue(200, 'upper', PRICE_RANGE)).toBe('480000000');
    lower.focus();
    await ue.keyboard('{End}');
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(mocks.replace).toHaveBeenLastCalledWith(
      `/procurement/items?${enc([['f.unitPrice.gte', '480000000']])}`,
    );
  });

  it('계약단가 범위가 없으면(단가 0건) 계약단가 필드가 없다 — URL 에 걸린 조건은 바에 보여 풀 수 있다', async () => {
    const ue = userEvent.setup();
    const { unmount } = render(
      <ItemsBrowser rows={ROWS} view={{ page: 1 }} total={2} choices={CHOICES} userId="u1" />,
    );
    expect(await moreFields(ue)).toEqual(['등록일자']);
    unmount();
    render(
      <ItemsBrowser
        rows={[]}
        view={{ page: 1, filters: [{ col: 'unitPrice', op: 'gte', value: '1000' }] }}
        total={0}
        choices={CHOICES}
        userId="u1"
      />,
    );
    expect(barFields()).toContain('계약단가');
    await ue.click(screen.getByRole('button', { name: '계약단가 필터 해제' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenLastCalledWith('/procurement/items'));
  });

  it('검색 제출 → q (replace, page 제거), 정렬 헤더 → push (1페이지), 필터 초기화 → push(빈 쿼리)', async () => {
    const ue = userEvent.setup();
    renderBrowser({ page: 2, filters: [{ col: 'product', op: 'in', values: ['WAPPLES'] }] });
    const search = screen.getByRole('searchbox', { name: '물품식별번호·품목명 검색' });
    await ue.type(search, ' 9000 {Enter}');
    expect(mocks.replace).toHaveBeenLastCalledWith(
      `/procurement/items?${enc([
        ['q', '9000'],
        ['f.product.in', 'WAPPLES'],
      ])}`,
    );
    await ue.click(within(screen.getByRole('table')).getByRole('button', { name: /^제조사/ }));
    expect(mocks.push).toHaveBeenLastCalledWith(
      `/procurement/items?${enc([['f.product.in', 'WAPPLES']])}&sort=manufacturer&dir=asc`,
    );
    await ue.click(within(quickBar()).getByRole('button', { name: '필터 초기화' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/procurement/items');
  });
});

describe('내려받기·페이지', () => {
  it('xlsx 링크 = 현재 조건(페이지 제외), 상한 이하면 안내 없음', () => {
    render(
      <ItemsExportLink
        view={{ page: 3, filters: [{ col: 'product', op: 'in', values: ['iSIGN'] }] }}
        total={10_000}
        limit={10_000}
      />,
    );
    const link = screen.getByRole('link', { name: 'xlsx 내려받기' });
    expect(link).toHaveAttribute(
      'href',
      `/procurement/items/export?${enc([['f.product.in', 'iSIGN']])}`,
    );
    expect(link).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(/만 내려받습니다/)).toBeNull();
  });

  it('상한을 넘으면 잘린다는 안내를 미리 보인다', () => {
    render(<ItemsExportLink view={{ page: 1 }} total={12_345} limit={10_000} />);
    const note = screen.getByText('결과 12,345건 중 앞의 10,000건만 내려받습니다');
    expect(screen.getByRole('link', { name: 'xlsx 내려받기' })).toHaveAttribute(
      'aria-describedby',
      note.id,
    );
  });

  it('페이지 링크는 현재 검색·필터·정렬을 유지한다', () => {
    render(
      <ItemsPagination
        view={{ page: 2, q: '가상', sort: { id: 'itemId', dir: 'desc' } }}
        page={2}
        pageCount={3}
        total={120}
      />,
    );
    expect(screen.getByText('총 120건 · 2 / 3 페이지')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '이전' })).toHaveAttribute(
      'href',
      `/procurement/items?q=${encodeURIComponent('가상')}&sort=itemId&dir=desc`,
    );
    expect(screen.getByRole('link', { name: '다음' })).toHaveAttribute(
      'href',
      `/procurement/items?q=${encodeURIComponent('가상')}&page=3&sort=itemId&dir=desc`,
    );
  });
});
