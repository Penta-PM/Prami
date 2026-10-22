import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CostRowView } from '@/features/costs/types';
import type { PriceRowView } from '@/features/pricing/types';
import type { AuditDisplayRow } from '@/lib/audit-format';

import {
  activeFields,
  applyField,
  barFields,
  moreFields,
  openField,
  quickBar,
  range,
  toggleField,
  typeText,
} from './server-quick-helpers';

/**
 * 표 열 필터 서버 3표 UI — 빠른 필터 바 (빠른 필터 바 §2, PR-3): 고정 필드 버튼(가격 단가 유형·상태·단가 / 원가 통화·원가·상태 /
 * 감사 일시·사용자·행위·결과)과 "＋ N개 더", 필터 변경 → router.replace(기존 필터 유지·page 제거·sort/dir 맨 뒤 — URL 형식 무변경),
 * 정렬·'필터 초기화' 는 현행 router.push, '필터 초기화' 노출 조건·범위(Plan Q1 B), 바 오른쪽 "총 N건 · 조건 K개",
 * 페이지 필터(leading)는 같은 카드 안, 감사 별칭(from·to·action·actor)·행위 다중 선택.
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  pathname: '/admin/policies',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }),
  usePathname: () => mocks.pathname,
}));
vi.mock('@/features/pricing/actions', () => ({ getPriceRowDetailAction: vi.fn() }));
vi.mock('@/features/costs/actions', () => ({}));

const { PricingBrowser } = await import('@/features/pricing/PricingBrowser');
const { CostBrowser } = await import('@/features/costs/CostBrowser');
const { AuditTable } = await import('@/features/audit/AuditTable');

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
  before: null,
  after: null,
  ip: '10.0.0.1',
  result: 'success',
  reason: null,
};

const enc = (pairs: [string, string][]) => new URLSearchParams(pairs).toString();

/** replace 가 새로 불렸는지 — enum 즉시 적용(400ms 디바운스) 대기용 */
const replacedAfter = (before: number) => () => mocks.replace.mock.calls.length > before;

const count = () => quickBar().querySelector('[data-quick-filter-count]')?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.pathname = '/admin/policies';
});

describe('가격 관리 표 빠른 필터 바', () => {
  const FILTER = {
    dateMode: 'period' as const,
    from: '2025-01-01',
    page: 3,
    major: 'WAPPLES',
    q: 'abc',
    sort: { id: 'price' as const, dir: 'desc' as const },
    filters: [{ col: 'status', op: 'in' as const, values: ['운영중'] }],
  };

  it('단가 유형(고정) = 데이터 distinct 다중 선택(빈 값은 "— (없음)") → 체크 즉시 f.priceType.in, 이동 1회(replace)', async () => {
    const ue = userEvent.setup();
    mocks.pathname = '/pricing';
    render(
      <PricingBrowser
        mode="view"
        rows={[PRICE_ROW]}
        filter={{ dateMode: 'start', page: 1 }}
        priceTypes={['정상판매', '할인', '__none__']}
        userId="u1"
      />,
    );
    const dialog = await openField(ue, '단가 유형');
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent),
    ).toEqual(['정상판매', '할인', '— (없음)']);
    await ue.keyboard('{Escape}');
    await toggleField(ue, '단가 유형', ['— (없음)', '정상판매'], replacedAfter(0));
    expect(mocks.replace.mock.calls).toEqual([
      [`/pricing?${enc([['f.priceType.in', '정상판매,__none__']])}`],
    ]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('고정 = 단가 유형·판매가(단가)·상태, ＋ 더 = 통화·가격 변동·품목상태·비고 — 분류·품목명·기간·운영 연도·원가 비중 없음', async () => {
    const ue = userEvent.setup();
    render(
      <PricingBrowser
        mode="admin"
        withPriceChange
        rows={[PRICE_ROW]}
        filter={{ dateMode: 'start', page: 1 }}
        currencies={['KRW', 'USD']}
        priceTypes={['정상판매']}
        costRatios={{ 7: { costRatio: 30, costFrom: '2026-05-01' } }}
        userId="u1"
      />,
    );
    expect(barFields()).toEqual(['단가 유형', '판매가', '상태']);
    expect(await moreFields(ue)).toEqual(['통화', '가격 변동', '품목상태', '비고']);
    // 기본 상태(필터·정렬 없음)에서는 '필터 초기화' 없음, 건수는 바 오른쪽
    expect(screen.queryByRole('button', { name: '필터 초기화' })).toBeNull();
    expect(count()).toBe('총 1건');
  });

  it('조회 표(/pricing): ＋ 더에 가격 변동 없음 (pricing-view-hide-price-change §2)', async () => {
    const ue = userEvent.setup();
    mocks.pathname = '/pricing';
    // 조회 화면 행에는 가격 변동 키 자체가 없다
    const viewRow: PriceRowView = { ...PRICE_ROW };
    delete viewRow.previousPrice;
    delete viewRow.priceChangeRate;
    render(
      <PricingBrowser
        mode="view"
        rows={[viewRow]}
        filter={{ dateMode: 'start', page: 1 }}
        currencies={['KRW', 'USD']}
        priceTypes={['정상판매']}
        userId="u1"
      />,
    );
    expect(barFields()).toEqual(['단가 유형', '판매가', '상태']);
    expect(await moreFields(ue)).toEqual(['통화', '품목상태', '비고']);
  });

  it('조건 추가 → 기존 필터·정렬 유지, page 제거, f.* 는 기존 필터 뒤·sort/dir 맨 뒤 (router.replace)', async () => {
    const ue = userEvent.setup();
    render(
      <PricingBrowser
        mode="admin"
        withPriceChange
        rows={[PRICE_ROW]}
        filter={FILTER}
        total={120}
        currencies={['KRW', 'USD']}
        userId="u1"
      />,
    );
    expect(activeFields()).toEqual(['상태: 운영중']);
    expect(count()).toBe('총 120건 · 조건 1개');
    const table = screen.getByRole('table', { name: '가격정책 관리 표' });
    expect(
      within(within(table).getByRole('columnheader', { name: /^상태/ })).getByTestId(
        'data-table-filter-dot',
      ),
    ).toBeInTheDocument();

    await applyField(ue, '비고', typeText(ue, '할인'));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      `/admin/policies?major=WAPPLES&dateMode=period&from=2025-01-01&q=abc&${enc([
        ['f.status.in', '운영중'],
        ['f.remark.has', '할인'],
      ])}&sort=price&dir=desc`,
    );

    // 통화 하나 (＋ 더 → enum 즉시 적용)
    await toggleField(ue, '통화', ['KRW'], replacedAfter(1));
    expect(mocks.replace.mock.lastCall?.[0]).toContain('f.currency.in=KRW&f.status.in=');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('판매가: 통화 미지정이면 같은 팝오버의 통화 라디오 + 범위 → 적용 시 통화 in·범위 두 조건 (§2.3)', async () => {
    const ue = userEvent.setup();
    render(
      <PricingBrowser
        mode="view"
        rows={[PRICE_ROW]}
        filter={{ dateMode: 'start', page: 1 }}
        currencies={['KRW', 'USD']}
        userId="u1"
      />,
    );
    const dialog = await openField(ue, '판매가');
    expect(within(dialog).getByText('통화를 먼저 선택하세요')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('최소')).toBeDisabled();
    await ue.keyboard('{Escape}');

    await applyField(ue, '판매가', range(ue, '1000', '5000', 'number', 'KRW'));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      `/admin/policies?${enc([
        ['f.currency.in', 'KRW'],
        ['f.price.gte', '1000'],
        ['f.price.lte', '5000'],
      ])}`,
    );
  });

  it("× 는 그 열만 해제(replace), '필터 초기화' 는 열 필터 + 분류·기간·검색 + 정렬을 모두 해제(push)", async () => {
    const ue = userEvent.setup();
    render(
      <PricingBrowser
        mode="admin"
        withPriceChange
        rows={[PRICE_ROW]}
        filter={FILTER}
        currencies={['KRW']}
        userId="u1"
      />,
    );
    await ue.click(screen.getByRole('button', { name: '상태 필터 해제' }));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      '/admin/policies?major=WAPPLES&dateMode=period&from=2025-01-01&q=abc&sort=price&dir=desc',
    );
    await ue.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/policies');
  });

  it("'필터 초기화' 노출 (Q1 B): 기존 필터(검색 q)만 있어도, 정렬만 있어도 보인다", () => {
    const { rerender } = render(
      <PricingBrowser
        mode="view"
        rows={[PRICE_ROW]}
        filter={{ dateMode: 'start', page: 1, q: 'abc' }}
        userId="u1"
      />,
    );
    expect(screen.getByRole('button', { name: '필터 초기화' })).toBeInTheDocument();
    rerender(
      <PricingBrowser
        mode="view"
        rows={[PRICE_ROW]}
        filter={{ dateMode: 'start', page: 1, sort: { id: 'remark', dir: 'asc' } }}
        userId="u1"
      />,
    );
    expect(screen.getByRole('button', { name: '필터 초기화' })).toBeInTheDocument();
  });

  it('필터 결과 0건: "조건에 맞는 결과가 없습니다" + [필터 초기화] → 전부 해제', async () => {
    const ue = userEvent.setup();
    render(<PricingBrowser mode="admin" withPriceChange rows={[]} filter={FILTER} userId="u1" />);
    expect(screen.getByText('조건에 맞는 결과가 없습니다')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: '필터 초기화' });
    await ue.click(buttons.at(-1)!);
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/policies');
  });

  it('페이지 필터(leading)는 바와 같은 카드(필터 그룹) 안, 바 위', () => {
    render(
      <PricingBrowser
        mode="view"
        rows={[PRICE_ROW]}
        filter={{ dateMode: 'start', page: 1 }}
        userId="u1"
        leading={<select aria-label="대분류" />}
      />,
    );
    const group = screen.getByRole('group', { name: '필터' });
    const select = within(group).getByRole('combobox', { name: '대분류' });
    expect(
      select.compareDocumentPosition(quickBar()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('디바운스 중인 체크 → 400ms 안에 정렬 헤더 클릭: 이동 URL 에 조건과 정렬이 모두 있다 (§6 #7 flush)', async () => {
    const ue = userEvent.setup();
    mocks.pathname = '/pricing';
    render(
      <PricingBrowser
        mode="view"
        rows={[PRICE_ROW]}
        filter={{ dateMode: 'start', page: 1, major: 'WAPPLES' }}
        userId="u1"
      />,
    );
    const dialog = await openField(ue, '상태');
    await ue.click(within(dialog).getByRole('checkbox', { name: '미사용' }));
    await ue.keyboard('{Escape}');
    const table = screen.getByRole('table', { name: '가격정책 표' });
    await ue.click(
      within(within(table).getByRole('columnheader', { name: /^판매가/ })).getByRole('button'),
    );
    expect(mocks.push.mock.calls).toEqual([
      [`/pricing?major=WAPPLES&${enc([['f.status.in', '미사용']])}&sort=price&dir=asc`],
    ]);
    // 디바운스 타이머는 취소됐다 — 뒤늦은 필터 이동 없음
    await new Promise((done) => setTimeout(done, 600));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
});

describe('원가 표 빠른 필터 바', () => {
  const FILTER = {
    dateMode: 'start' as const,
    page: 2,
    family: 'WAPPLES',
    q: 'W1',
    sort: { id: 'name' as const, dir: 'asc' as const },
  };

  it('고정 = 통화·원가·상태, ＋ 더 = 단위 (코드·원자재명·기간 없음), 조건 추가 → replace·page 제거·sort 맨 뒤, 초기화 → 제품군 탭만 남기고 해제 (§7 Q5)', async () => {
    const ue = userEvent.setup();
    render(
      <CostBrowser
        rows={[COST_ROW]}
        filter={FILTER}
        total={42}
        currencies={['KRW', 'USD']}
        userId="u1"
      />,
    );
    expect(barFields()).toEqual(['통화', '원가', '상태']);
    expect(await moreFields(ue)).toEqual(['단위']);
    expect(count()).toBe('총 42건');
    await toggleField(ue, '상태', ['미사용'], replacedAfter(0));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      `/admin/costs?family=WAPPLES&q=W1&${enc([['f.status.in', '미사용']])}&sort=name&dir=asc`,
    );
    await ue.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/costs?family=WAPPLES');
  });

  it("제품군 탭만 있으면 필터가 아니다: '필터 초기화' 없음, 0건은 데이터 없음 문구", () => {
    render(
      <CostBrowser
        rows={[]}
        filter={{ dateMode: 'start', page: 1, family: 'WAPPLES' }}
        userId="u1"
      />,
    );
    expect(screen.queryByRole('button', { name: '필터 초기화' })).toBeNull();
    expect(screen.getByText('등록된 원가가 없습니다.')).toBeInTheDocument();
  });

  it('데이터 없음 / 필터 결과 없음 빈 상태 (필터 결과 없음의 초기화도 탭 유지)', async () => {
    const ue = userEvent.setup();
    const { rerender } = render(
      <CostBrowser rows={[]} filter={{ dateMode: 'start', page: 1 }} userId="u1" />,
    );
    expect(screen.getByText('등록된 원가가 없습니다.')).toBeInTheDocument();
    rerender(<CostBrowser rows={[]} filter={FILTER} userId="u1" />);
    expect(screen.getByText('조건에 맞는 결과가 없습니다')).toBeInTheDocument();
    await ue.click(screen.getAllByRole('button', { name: '필터 초기화' }).at(-1)!);
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/costs?family=WAPPLES');
  });

  it('제품군 탭(leading)은 바와 같은 카드 안', () => {
    render(
      <CostBrowser
        rows={[COST_ROW]}
        filter={{ dateMode: 'start', page: 1 }}
        userId="u1"
        leading={<nav aria-label="제품군" />}
      />,
    );
    expect(
      within(screen.getByRole('group', { name: '필터' })).getByRole('navigation', {
        name: '제품군',
      }),
    ).toBeInTheDocument();
  });
});

describe('감사 표 빠른 필터 바 (옛 GET 폼 흡수, 별칭)', () => {
  const ACTIONS = ['auth.login', 'price_policy.create', 'user.update'];

  it('옛 URL ?action=X → 행위 버튼에 값, 고정 = 일시·사용자·행위·결과, ＋ 더 = 대상·IP (변경 전/후 없음)', async () => {
    const ue = userEvent.setup();
    render(
      <AuditTable
        rows={[AUDIT_ROW]}
        filter={{ page: 1, action: ['user.update'] }}
        actions={ACTIONS}
        total={9}
        userId="u1"
      />,
    );
    expect(activeFields()).toEqual(['행위: user.update']);
    expect(barFields()).toEqual(['일시', '사용자', '행위', '결과']);
    expect(await moreFields(ue)).toEqual(['대상', 'IP']);
    expect(count()).toBe('총 9건 · 조건 1개');
  });

  it('행위 다중 선택 → action=a,b (쉼표), 기간 → from·to, 사용자 포함 → actor, 같음 → f.actor.eq, 정렬 맨 뒤 (replace)', async () => {
    const ue = userEvent.setup();
    const sort = { id: 'ip' as const, dir: 'desc' as const };
    const { rerender } = render(
      <AuditTable
        rows={[AUDIT_ROW]}
        filter={{ page: 3, action: ['user.update'], sort }}
        actions={ACTIONS}
        userId="u1"
      />,
    );
    await toggleField(ue, '행위', ['auth.login'], replacedAfter(0));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      `/admin/audit?${enc([['action', 'auth.login,user.update']])}&sort=ip&dir=desc`,
    );

    // URL 이 따라잡은 것처럼 요청한 필터로 다시 그린다(대기 중 조건 정리)
    rerender(
      <AuditTable
        rows={[AUDIT_ROW]}
        filter={{ page: 1, action: ['auth.login', 'user.update'], sort }}
        actions={ACTIONS}
        userId="u1"
      />,
    );
    await applyField(ue, '일시', range(ue, '2026-09-01', '2026-09-30', 'date'));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      `/admin/audit?from=2026-09-01&to=2026-09-30&${enc([['action', 'auth.login,user.update']])}&sort=ip&dir=desc`,
    );

    // 다른 URL(외부 변경)로 다시 그리면 대기 중 조건은 버려진다
    rerender(
      <AuditTable rows={[AUDIT_ROW]} filter={{ page: 1, sort }} actions={ACTIONS} userId="u1" />,
    );
    await applyField(ue, '사용자', typeText(ue, 'kim'));
    expect(mocks.replace).toHaveBeenLastCalledWith('/admin/audit?actor=kim&sort=ip&dir=desc');

    rerender(
      <AuditTable
        rows={[AUDIT_ROW]}
        filter={{ page: 1, actor: 'kim', sort }}
        actions={ACTIONS}
        userId="u1"
      />,
    );
    const calls = mocks.replace.mock.calls.length;
    await toggleField(ue, '결과', ['거부'], replacedAfter(calls));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      '/admin/audit?actor=kim&f.result.in=denied&sort=ip&dir=desc',
    );

    rerender(
      <AuditTable rows={[AUDIT_ROW]} filter={{ page: 1, sort }} actions={ACTIONS} userId="u1" />,
    );
    await applyField(ue, '사용자', typeText(ue, 'kim', '같음'));
    expect(mocks.replace).toHaveBeenLastCalledWith('/admin/audit?f.actor.eq=kim&sort=ip&dir=desc');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("'필터 초기화' = 별칭 포함 열 필터 + 정렬 해제 (push)", async () => {
    const ue = userEvent.setup();
    render(
      <AuditTable
        rows={[AUDIT_ROW]}
        filter={{
          page: 2,
          from: '2026-09-01',
          actor: 'kim',
          filters: [{ col: 'result', op: 'in', values: ['error'] }],
          sort: { id: 'actor', dir: 'asc' },
        }}
        actions={ACTIONS}
        userId="u1"
      />,
    );
    expect(activeFields()).toEqual(['일시: 2026-09-01 ~', '사용자: "kim" 포함', '결과: 오류']);
    await ue.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/audit');
  });

  it('디바운스 중인 행위 체크 → 정렬: 별칭(action)과 정렬이 한 이동에 (§6 #7 flush)', async () => {
    const ue = userEvent.setup();
    render(
      <AuditTable
        rows={[AUDIT_ROW]}
        filter={{ page: 1, actor: 'kim' }}
        actions={ACTIONS}
        userId="u1"
      />,
    );
    const dialog = await openField(ue, '행위');
    await ue.click(within(dialog).getByRole('checkbox', { name: 'auth.login' }));
    await ue.keyboard('{Escape}');
    const table = screen.getByRole('table', { name: '감사 로그' });
    await ue.click(
      within(within(table).getByRole('columnheader', { name: /^IP/ })).getByRole('button'),
    );
    expect(mocks.push.mock.calls).toEqual([
      ['/admin/audit?action=auth.login&actor=kim&sort=ip&dir=asc'],
    ]);
  });
});
