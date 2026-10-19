import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CostRowView } from '@/features/costs/types';
import type { PriceRowView } from '@/features/pricing/types';
import type { AuditDisplayRow } from '@/lib/audit-format';

import { addFilter, check, chips, range, typeText } from './helpers';

/**
 * 표 열 필터 A-2 서버 3표 UI (스펙 §2.2·§2.4·§2.5, Plan Q1 B·Q3 A): 툴바 필드(같은 의미 열 없음·원가 비중 없음),
 * 필터 변경 → router.push(기존 필터 유지·page 제거·sort/dir 맨 뒤), '필터 초기화' 노출 조건·기존 필터+정렬까지 해제,
 * 감사 별칭(from·to·action·actor)·행위 다중 선택.
 */
const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), pathname: '/admin/policies' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
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

/** "＋ 필터" 를 열어 고를 수 있는 열 이름 목록 */
async function fieldNames(ue: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await ue.click(screen.getByRole('button', { name: '＋ 필터' }));
  const picker = await screen.findByRole('dialog', { name: '필터할 열 선택' });
  const names = within(picker)
    .getAllByRole('button')
    .map((button) => button.textContent?.replace('적용 중', '') ?? '');
  await ue.keyboard('{Escape}');
  return names;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.pathname = '/admin/policies';
});

describe('가격 관리 표 열 필터', () => {
  const FILTER = {
    dateMode: 'period' as const,
    from: '2025-01-01',
    page: 3,
    major: 'WAPPLES',
    q: 'abc',
    sort: { id: 'price' as const, dir: 'desc' as const },
    filters: [{ col: 'status', op: 'in' as const, values: ['운영중'] }],
  };

  it('단가 유형 = 데이터 distinct 다중 선택(빈 값은 "— (없음)") → f.priceType.in', async () => {
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
    await addFilter(ue, '단가 유형', async (dialog) => {
      expect(
        within(dialog)
          .getAllByRole('checkbox')
          .map((box) => box.closest('label')?.textContent),
      ).toEqual(['정상판매', '할인', '— (없음)']);
      await check(ue, '— (없음)', '정상판매')(dialog);
    });
    expect(mocks.push).toHaveBeenLastCalledWith(
      `/pricing?${enc([['f.priceType.in', '정상판매,__none__']])}`,
    );
  });

  it('필드 = 단가 유형·통화·판매가·가격 변동·품목상태·상태·비고 — 분류·품목명·기간·운영 연도·원가 비중 없음', async () => {
    const ue = userEvent.setup();
    render(
      <PricingBrowser
        mode="admin"
        rows={[PRICE_ROW]}
        filter={{ dateMode: 'start', page: 1 }}
        currencies={['KRW', 'USD']}
        priceTypes={['정상판매']}
        costRatios={{ 7: { costRatio: 30, costFrom: '2026-05-01' } }}
        userId="u1"
      />,
    );
    expect(await fieldNames(ue)).toEqual([
      '단가 유형',
      '통화',
      '판매가',
      '가격 변동',
      '품목상태',
      '상태',
      '비고',
    ]);
    // 기본 상태(필터·정렬 없음)에서는 '필터 초기화' 없음
    expect(screen.queryByRole('button', { name: '필터 초기화' })).toBeNull();
  });

  it('조건 추가 → 기존 필터·정렬 유지, page 제거, f.* 는 기존 필터 뒤·sort/dir 맨 뒤 (router.push)', async () => {
    const ue = userEvent.setup();
    render(
      <PricingBrowser
        mode="admin"
        rows={[PRICE_ROW]}
        filter={FILTER}
        total={120}
        currencies={['KRW', 'USD']}
        userId="u1"
      />,
    );
    expect(chips()).toEqual(['상태: 운영중']);
    const table = screen.getByRole('table', { name: '가격정책 관리 표' });
    expect(
      within(within(table).getByRole('columnheader', { name: /^상태/ })).getByTestId(
        'data-table-filter-dot',
      ),
    ).toBeInTheDocument();

    await addFilter(ue, '비고', typeText(ue, '할인'));
    expect(mocks.push).toHaveBeenLastCalledWith(
      `/admin/policies?major=WAPPLES&dateMode=period&from=2025-01-01&q=abc&${enc([
        ['f.status.in', '운영중'],
        ['f.remark.has', '할인'],
      ])}&sort=price&dir=desc`,
    );

    // 통화 하나 + 판매가 범위
    await addFilter(ue, '통화', check(ue, 'KRW'));
    expect(mocks.push.mock.lastCall?.[0]).toContain('f.currency.in=KRW&f.status.in=');
  });

  it('통화 미선택이면 판매가 범위 비활성 + "통화를 먼저 선택하세요"', async () => {
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
    await ue.click(screen.getByRole('button', { name: '＋ 필터' }));
    await ue.click(
      within(await screen.findByRole('dialog', { name: '필터할 열 선택' })).getByRole('button', {
        name: '판매가',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: '판매가 필터' });
    expect(within(dialog).getByText('통화를 먼저 선택하세요')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('최소')).toBeDisabled();
  });

  it("칩 × 는 그 열만 해제, '필터 초기화' 는 열 필터 + 분류·기간·검색 + 정렬을 모두 해제", async () => {
    const ue = userEvent.setup();
    render(
      <PricingBrowser
        mode="admin"
        rows={[PRICE_ROW]}
        filter={FILTER}
        currencies={['KRW']}
        userId="u1"
      />,
    );
    await ue.click(screen.getByRole('button', { name: '상태 필터 해제' }));
    expect(mocks.push).toHaveBeenLastCalledWith(
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
    render(<PricingBrowser mode="admin" rows={[]} filter={FILTER} userId="u1" />);
    expect(screen.getByText('조건에 맞는 결과가 없습니다')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: '필터 초기화' });
    await ue.click(buttons.at(-1)!);
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/policies');
  });
});

describe('원가 표 열 필터', () => {
  const FILTER = {
    dateMode: 'start' as const,
    page: 2,
    family: 'WAPPLES',
    q: 'W1',
    sort: { id: 'name' as const, dir: 'asc' as const },
  };

  it('필드 = 단위·통화·원가·상태 (코드·원자재명·기간 없음), 조건 추가 → page 제거·sort 맨 뒤, 초기화 → 제품군 탭만 남기고 해제 (§7 Q5)', async () => {
    const ue = userEvent.setup();
    render(
      <CostBrowser rows={[COST_ROW]} filter={FILTER} currencies={['KRW', 'USD']} userId="u1" />,
    );
    expect(await fieldNames(ue)).toEqual(['단위', '통화', '원가', '상태']);
    await addFilter(ue, '상태', check(ue, '미사용'));
    expect(mocks.push).toHaveBeenLastCalledWith(
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
});

describe('감사 표 열 필터 (옛 GET 폼 흡수, 별칭)', () => {
  const ACTIONS = ['auth.login', 'price_policy.create', 'user.update'];

  it('옛 URL ?action=X → 행위 칩, 필드 = 일시·사용자·행위·대상·IP·결과 (변경 전/후 없음)', async () => {
    const ue = userEvent.setup();
    render(
      <AuditTable
        rows={[AUDIT_ROW]}
        filter={{ page: 1, action: ['user.update'] }}
        actions={ACTIONS}
        userId="u1"
      />,
    );
    expect(chips()).toEqual(['행위: user.update']);
    expect(await fieldNames(ue)).toEqual(['일시', '사용자', '행위', '대상', 'IP', '결과']);
  });

  it('행위 다중 선택 → action=a,b (쉼표), 기간 → from·to, 사용자 포함 → actor, 같음 → f.actor.eq, 정렬 맨 뒤', async () => {
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
    await addFilter(ue, '행위', check(ue, 'auth.login'));
    expect(mocks.push).toHaveBeenLastCalledWith(
      `/admin/audit?${enc([['action', 'auth.login,user.update']])}&sort=ip&dir=desc`,
    );

    await addFilter(ue, '일시', range(ue, '2026-09-01', '2026-09-30', 'date'));
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/admin/audit?from=2026-09-01&to=2026-09-30&action=user.update&sort=ip&dir=desc',
    );

    rerender(
      <AuditTable rows={[AUDIT_ROW]} filter={{ page: 1, sort }} actions={ACTIONS} userId="u1" />,
    );
    await addFilter(ue, '사용자', typeText(ue, 'kim'));
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/audit?actor=kim&sort=ip&dir=desc');
    await addFilter(ue, '결과', check(ue, '거부'));
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/audit?f.result.in=denied&sort=ip&dir=desc');
    await addFilter(ue, '사용자', typeText(ue, 'kim', '같음'));
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/audit?f.actor.eq=kim&sort=ip&dir=desc');
  });

  it("'필터 초기화' = 별칭 포함 열 필터 + 정렬 해제", async () => {
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
    expect(chips()).toEqual(['일시: 2026-09-01 ~', '사용자: "kim" 포함', '결과: 오류']);
    await ue.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(mocks.push).toHaveBeenLastCalledWith('/admin/audit');
  });
});
