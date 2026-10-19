import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CostRowView } from '@/features/costs/types';
import type { PriceRowView } from '@/features/pricing/types';
import type { AuditDisplayRow } from '@/lib/audit-format';

/**
 * #32 PR-3 서버 정렬 표 (가격·원가·감사): 헤더 클릭 → router.push 로 URL 의 sort/dir 만 바꾸고(맨 뒤) 1페이지로 간다.
 * 필터·탭·페이지 이동·감사 열 필터(옛 GET 폼 흡수)가 정렬을 끌고 다닌다. Server Action·라우터는 모킹
 */
const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), pathname: '/pricing' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => mocks.pathname,
}));
vi.mock('@/features/pricing/actions', () => ({ getPriceRowDetailAction: vi.fn() }));
vi.mock('@/features/costs/actions', () => ({}));

const { PriceTable } = await import('@/features/pricing/PriceTable');
const { PricingBrowser } = await import('@/features/pricing/PricingBrowser');
const { PricingPagination } = await import('@/features/pricing/PricingPagination');
const { CostBrowser } = await import('@/features/costs/CostBrowser');
const { CostFilters } = await import('@/features/costs/CostFilters');
const { CostPagination } = await import('@/features/costs/CostPagination');
const { AuditTable } = await import('@/features/audit/AuditTable');
const { AuditPagination } = await import('@/features/audit/AuditPagination');

const PRICE_ROW: PriceRowView = {
  id: 7,
  priceType: '정상판매',
  major: 'WAPPLES',
  mid: 'Appliance',
  minor: 'H500',
  itemCode: 'P10100015',
  itemName: 'Wapples-500 (H500 T2)',
  unitPrice: '12500000.00',
  currency: 'KRW',
  effectiveFrom: '2022-04-01',
  effectiveTo: null,
  itemStatus: '사용',
  operationStatus: '운영중',
  remark: null,
  source: 'erp',
  previousPrice: null,
  priceChangeRate: null,
};

const COST_ROW: CostRowView = {
  id: 3,
  materialCode: 'W10100016',
  materialName: 'WAPPLES-100 (H100 T2)',
  unit: 'EA',
  unitCost: '984000.00',
  currency: 'KRW',
  effectiveFrom: '2024-01-01',
  effectiveTo: null,
  operationStatus: '운영중',
  productFamily: 'WAPPLES',
  remark: null,
  source: 'erp',
};

const AUDIT_ROW: AuditDisplayRow = {
  id: 1,
  createdAt: new Date('2026-09-23T00:00:00Z'),
  actorLabel: 'admin@pentasecurity.com',
  action: 'user.update',
  targetType: 'user',
  targetLabel: 'member@pentasecurity.com',
  targetId: 'u-1',
  before: { role: 'USER' },
  after: { role: 'ADMIN' },
  ip: '10.0.0.1',
  result: 'success',
  reason: null,
};

const th = (table: HTMLElement, name: string) => within(table).getByRole('columnheader', { name });
const clickHeader = (table: HTMLElement, name: string) =>
  userEvent.click(within(th(table, name)).getByRole('button'));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.pathname = '/pricing';
});

describe('가격 표 (서버 정렬)', () => {
  const FILTER = { dateMode: 'start' as const, page: 3, major: 'WAPPLES' };

  it('헤더 클릭 → 필터 유지 + page 제거 + sort/dir 맨 뒤, 열마다 id = 정렬 키', async () => {
    render(<PricingBrowser mode="view" rows={[PRICE_ROW]} filter={FILTER} userId="u1" />);
    const table = screen.getByRole('table', { name: '가격정책 표' });
    await clickHeader(table, '판매가');
    expect(mocks.push).toHaveBeenLastCalledWith('/pricing?major=WAPPLES&sort=price&dir=asc');
    await clickHeader(table, '품목상태');
    expect(mocks.push).toHaveBeenLastCalledWith('/pricing?major=WAPPLES&sort=itemStatus&dir=asc');
  });

  it('관리 표: URL 정렬을 aria-sort 로 보이고, 오름 → 내림 → 해제(sort/dir 제거)', async () => {
    mocks.pathname = '/admin/policies';
    const { rerender } = render(
      <PricingBrowser
        mode="admin"
        rows={[PRICE_ROW]}
        filter={{ ...FILTER, sort: { id: 'effectiveFrom', dir: 'asc' } }}
        userId="u1"
      />,
    );
    const table = screen.getByRole('table', { name: '가격정책 관리 표' });
    expect(th(table, '적용시작일')).toHaveAttribute('aria-sort', 'ascending');
    await clickHeader(table, '적용시작일');
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/admin/policies?major=WAPPLES&sort=effectiveFrom&dir=desc',
    );

    rerender(
      <PricingBrowser
        mode="admin"
        rows={[PRICE_ROW]}
        filter={{ ...FILTER, sort: { id: 'effectiveFrom', dir: 'desc' } }}
        userId="u1"
      />,
    );
    expect(th(table, '적용시작일')).toHaveAttribute('aria-sort', 'descending');
    await clickHeader(table, '적용시작일');
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/policies?major=WAPPLES');
  });

  it('관리 열은 정렬하지 않는다 (버튼·aria-sort 없음), 열 초기화 버튼은 기본 상태에서 비활성', () => {
    render(<PricingBrowser mode="admin" rows={[PRICE_ROW]} filter={FILTER} userId="u1" />);
    const table = screen.getByRole('table', { name: '가격정책 관리 표' });
    const actions = th(table, '관리');
    expect(within(actions).queryByRole('button')).toBeNull();
    expect(actions).not.toHaveAttribute('aria-sort');
    expect(screen.getByRole('button', { name: '열 초기화' })).toBeDisabled();
  });

  it('헤더 조작은 행 클릭(드로어)으로 번지지 않는다', async () => {
    const onRowClick = vi.fn();
    const onSortChange = vi.fn();
    render(
      <PriceTable
        mode="view"
        rows={[PRICE_ROW]}
        userId="u1"
        onSortChange={onSortChange}
        onRowClick={onRowClick}
      />,
    );
    const table = screen.getByRole('table', { name: '가격정책 표' });
    await clickHeader(table, '품목명');
    expect(onSortChange).toHaveBeenCalledWith({ id: 'itemName', dir: 'asc' });
    await userEvent.click(within(th(table, '품목명')).getByRole('separator'));
    expect(onRowClick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Wapples-500 (H500 T2)'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('페이지 링크는 정렬을 맨 뒤에 유지한다', () => {
    render(
      <PricingPagination
        basePath="/pricing"
        filter={{ ...FILTER, page: 2, sort: { id: 'price', dir: 'desc' } }}
        page={2}
        pageCount={3}
        total={120}
      />,
    );
    expect(screen.getByRole('link', { name: '다음' })).toHaveAttribute(
      'href',
      '/pricing?major=WAPPLES&page=3&sort=price&dir=desc',
    );
  });
});

describe('원가 표 (서버 정렬)', () => {
  const FILTER = { dateMode: 'start' as const, page: 2, family: 'WAPPLES', q: 'W1' };

  it("'단위' 헤더(셀 = row.unit)와 정렬 id 'unit' — 필터 유지 + page 제거 + sort/dir 맨 뒤", async () => {
    render(<CostBrowser rows={[COST_ROW]} filter={FILTER} userId="u1" />);
    const table = screen.getByRole('table', { name: '원가 표' });
    expect(within(table).queryByRole('columnheader', { name: '분류' })).toBeNull();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('EA');
    await clickHeader(table, '단위');
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/admin/costs?family=WAPPLES&q=W1&sort=unit&dir=asc',
    );
  });

  it('내림차순에서 클릭하면 정렬 해제, 관리 열은 정렬하지 않는다', async () => {
    render(
      <CostBrowser
        rows={[COST_ROW]}
        filter={{ ...FILTER, sort: { id: 'cost', dir: 'desc' } }}
        userId="u1"
      />,
    );
    const table = screen.getByRole('table', { name: '원가 표' });
    expect(th(table, '원가')).toHaveAttribute('aria-sort', 'descending');
    await clickHeader(table, '원가');
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/costs?family=WAPPLES&q=W1');
    expect(within(th(table, '관리')).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: '열 초기화' })).toBeDisabled();
  });

  it('제품군 탭·검색·페이지 이동이 정렬을 유지한다', async () => {
    const sorted = { ...FILTER, sort: { id: 'name' as const, dir: 'asc' as const } };
    render(
      <>
        <CostFilters
          filter={sorted}
          errors={{}}
          families={[{ family: 'WAPPLES', count: 3 }]}
          years={[2026]}
        />
        <CostPagination filter={sorted} page={2} pageCount={3} total={120} />
      </>,
    );
    expect(screen.getByRole('link', { name: /전체/ })).toHaveAttribute(
      'href',
      '/admin/costs?q=W1&sort=name&dir=asc',
    );
    expect(screen.getByRole('link', { name: '다음' })).toHaveAttribute(
      'href',
      '/admin/costs?family=WAPPLES&q=W1&page=3&sort=name&dir=asc',
    );
    const search = screen.getByRole('searchbox', { name: '원자재명·코드 검색' });
    await userEvent.clear(search);
    await userEvent.type(search, 'W4{Enter}');
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/admin/costs?family=WAPPLES&q=W4&sort=name&dir=asc',
    );
  });
});

describe('감사 로그 표 (서버 정렬)', () => {
  const FILTER = { page: 2, action: ['user.update'] };

  it('헤더 클릭 → 필터 유지 + page 제거 + sort/dir 맨 뒤, 변경 전/후는 정렬하지 않는다', async () => {
    render(<AuditTable rows={[AUDIT_ROW]} filter={FILTER} userId="u1" />);
    const table = screen.getByRole('table', { name: '감사 로그' });
    await clickHeader(table, '일시');
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/admin/audit?action=user.update&sort=createdAt&dir=asc',
    );
    await clickHeader(table, '결과');
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/admin/audit?action=user.update&sort=result&dir=asc',
    );
    for (const name of ['변경 전', '변경 후']) {
      const header = th(table, name);
      expect(header).not.toHaveAttribute('aria-sort');
      // 이동용 버튼은 있지만(키보드 재배치) 눌러도 정렬하지 않는다
      await userEvent.click(within(header).getByRole('button'));
      expect(within(header).getByRole('separator')).toBeInTheDocument();
    }
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });

  it('내림차순에서 클릭하면 정렬 해제', async () => {
    render(
      <AuditTable
        rows={[AUDIT_ROW]}
        filter={{ ...FILTER, sort: { id: 'actor', dir: 'desc' } }}
        userId="u1"
      />,
    );
    const table = screen.getByRole('table', { name: '감사 로그' });
    expect(th(table, '사용자')).toHaveAttribute('aria-sort', 'descending');
    await clickHeader(table, '사용자');
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/audit?action=user.update');
  });

  it('옛 GET 폼은 없고, 열 필터 칩 해제가 정렬을 맨 뒤에 유지한다 (표 열 필터 §2.4)', async () => {
    render(
      <AuditTable
        rows={[AUDIT_ROW]}
        filter={{ ...FILTER, sort: { id: 'ip', dir: 'desc' } }}
        actions={['user.update']}
        userId="u1"
      />,
    );
    expect(screen.queryByRole('form', { name: '감사 로그 필터' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '행위 필터 해제' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/audit?sort=ip&dir=desc');
  });

  it('페이지 링크는 정렬을 맨 뒤에 유지한다', () => {
    render(
      <AuditPagination
        filter={{ ...FILTER, sort: { id: 'createdAt', dir: 'asc' } }}
        page={2}
        pageCount={3}
        total={120}
      />,
    );
    expect(screen.getByRole('link', { name: '다음' })).toHaveAttribute(
      'href',
      '/admin/audit?action=user.update&page=3&sort=createdAt&dir=asc',
    );
  });
});
