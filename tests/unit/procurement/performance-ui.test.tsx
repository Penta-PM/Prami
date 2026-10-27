import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PerformanceDashboard,
  type PerformanceDashboardProps,
} from '@/features/procurement/performance/PerformanceDashboard';
import {
  DEFAULT_PERFORMANCE_VIEW,
  periodPresets,
  type PerformanceView,
} from '@/lib/procurement/performance-filter';
import type { MonthlyReportRow, YearlyPerformance } from '@/server/procurement/performance';

import { navigation } from '../../helpers/next-navigation';

/**
 * 조달이 통합 UI-5 — 실적 현황 화면 조작(클라이언트): 제품 탭·세부 그룹·기간·기준월 → URL(router.replace),
 * 보고표 열(원본 구성), 콤보 차트 ↔ 제조사 표 강조 연동, 월 클릭 → 계약 목록(페이지 링크), 연도별 더보기 모달, 접근성 기본.
 * 데이터는 합성(가상 제조사). 서버 조회는 props, 모달 조회(Server Action)는 모킹.
 */
vi.mock(
  'next/navigation',
  async () => (await import('../../helpers/next-navigation')).navigationModule,
);

const actions = vi.hoisted(() => ({
  report: vi.fn(),
  yearly: vi.fn(),
}));
vi.mock('@/features/procurement/performance/actions', () => ({
  getManufacturerReportAction: actions.report,
  getYearlyPerformanceAllAction: actions.yearly,
}));

const M = 1_000_000;
const OURS = '(주)펜타시큐리티';
const MONTHS = ['2025-01', '2025-02', '2025-03'];

function reportRow(values: Partial<MonthlyReportRow>): MonthlyReportRow {
  return {
    key: null,
    monthAmount: 0,
    monthContractCount: 0,
    ytdAmount: 0,
    ytdContractCount: 0,
    previousMonthAmount: 0,
    previousYtdAmount: 0,
    previousYearAmount: 0,
    ourMonthAmount: 0,
    ourYtdAmount: 0,
    ytdChangeRate: null,
    ourYtdShare: null,
    ...values,
  };
}

function yearlyOf(
  names: [string, boolean, number, number][],
  count = names.length,
): YearlyPerformance {
  return {
    years: [2024, 2025],
    totals: [
      { year: 2024, amount: 100 * M, contractCount: 3, ourAmount: 0, ourShare: null },
      { year: 2025, amount: 200 * M, contractCount: 5, ourAmount: 0, ourShare: null },
    ],
    manufacturers: names.map(([name, isOurs, a, b]) => ({
      manufacturer: name,
      isOurs,
      totalAmount: a + b,
      years: [
        { year: 2024, amount: a, share: null },
        { year: 2025, amount: b, share: null },
      ],
    })),
    manufacturerCount: count,
  };
}

function props(
  overrides: Partial<PerformanceDashboardProps> = {},
  view: Partial<PerformanceView> = {},
) {
  const base: PerformanceDashboardProps = {
    view: { ...DEFAULT_PERFORMANCE_VIEW, from: '2025-01', to: '2025-03', ...view },
    resolved: {
      from: '2025-01',
      to: '2025-03',
      month: '2025-03',
      sel: null,
      months: ['2024-01', ...MONTHS],
      presets: periodPresets('2025-03', '2024-01'),
    },
    hasData: true,
    volumes: [
      { month: '2024-01', amount: 60 * M },
      { month: '2025-01', amount: 150 * M },
      { month: '2025-02', amount: 0 },
      { month: '2025-03', amount: 50 * M },
    ],
    kpis: {
      amount: 200 * M,
      contractCount: 4,
      deliveryCount: 5,
      ourAmount: 120 * M,
      ourShare: 0.6,
      previous: { amount: 65 * M, contractCount: 2, deliveryCount: 2, ourAmount: 60 * M },
      amountChangeRate: null,
    },
    manufacturers: {
      rows: [
        {
          manufacturer: OURS,
          isOurs: true,
          amount: 120 * M,
          contractCount: 2,
          share: 0.6,
          previousAmount: 60 * M,
          changeRate: 1,
        },
        {
          manufacturer: '가상인증',
          isOurs: false,
          amount: 50 * M,
          contractCount: 2,
          share: 0.25,
          previousAmount: 0,
          changeRate: null,
        },
        {
          manufacturer: '가상보안',
          isOurs: false,
          amount: 30 * M,
          contractCount: 1,
          share: 0.15,
          previousAmount: 5 * M,
          changeRate: 5,
        },
      ],
      total: { amount: 200 * M, contractCount: 4, previousAmount: 65 * M },
    },
    chart: {
      months: MONTHS,
      manufacturerCount: 3,
      amount: 200 * M,
      series: [
        {
          manufacturer: OURS,
          isOurs: true,
          isOthers: false,
          memberCount: 1,
          amount: 120 * M,
          values: [120 * M, 0, 0],
        },
        {
          manufacturer: '가상인증',
          isOurs: false,
          isOthers: false,
          memberCount: 1,
          amount: 50 * M,
          values: [0, 0, 50 * M],
        },
        {
          manufacturer: '가상보안',
          isOurs: false,
          isOthers: false,
          memberCount: 1,
          amount: 30 * M,
          values: [30 * M, 0, 0],
        },
      ],
    },
    reportTotal: reportRow({
      monthAmount: 50 * M,
      ytdAmount: 200 * M,
      previousMonthAmount: 5 * M,
      previousYtdAmount: 65 * M,
      ourYtdAmount: 120 * M,
    }),
    ourByMonth: [
      ['2024-01', 60 * M],
      ['2025-01', 120 * M],
    ],
    yearly: yearlyOf([
      [OURS, true, 60 * M, 120 * M],
      ['가상인증', false, 0, 50 * M],
      ['가상보안', false, 5 * M, 30 * M],
    ]),
    contracts: null,
  };
  return { ...base, ...overrides };
}

const lastHref = () => navigation.replace.mock.calls.at(-1)?.[0] as string | undefined;
const query = () => new URLSearchParams(lastHref()?.split('?')[1] ?? '');

beforeEach(() => {
  navigation.reset('/procurement', 'from=2025-01&to=2025-03');
  actions.report.mockReset();
  actions.yearly.mockReset();
});

describe('제품 탭·세부 그룹·기간·기준월 → URL', () => {
  it('제품 탭: 기간은 유지하고 기준월·고른 달·강조는 초기화', async () => {
    const user = userEvent.setup();
    render(
      <PerformanceDashboard
        {...props({}, { month: '2025-02', sel: '2025-01', mfr: 'm:가상보안' })}
      />,
    );
    const tabs = screen.getByRole('group', { name: '제품' });
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['전체', 'WAPPLES', 'D.AMO', 'iSIGN']);
    expect(within(tabs).getByRole('button', { name: '전체' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(tabs).getByRole('button', { name: 'WAPPLES' }));
    expect(lastHref()).toBe('/procurement?tab=WAPPLES&from=2025-01&to=2025-03');
  });

  it('iSIGN 세부 그룹: 고르면 group, 같은 그룹을 다시 누르면 전체로', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PerformanceDashboard {...props({}, { tab: 'iSIGN' })} />);
    const groups = screen.getByRole('group', { name: 'iSIGN 세부 그룹' });
    expect(
      within(groups)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['전체', 'SSO', 'WA', 'PASS', 'OS 로그온', '기타']);
    await user.click(within(groups).getByRole('button', { name: 'SSO' }));
    expect(lastHref()).toBe('/procurement?tab=iSIGN&group=SSO&from=2025-01&to=2025-03');
    rerender(<PerformanceDashboard {...props({}, { tab: 'iSIGN', group: 'SSO' })} />);
    await user.click(screen.getByRole('button', { name: 'SSO' }));
    expect(lastHref()).toBe('/procurement?tab=iSIGN&from=2025-01&to=2025-03');
    expect(screen.queryByRole('group', { name: 'iSIGN 세부 그룹' })).toBeInTheDocument();
  });

  it('기간 프리셋·시작/종료 월 입력 → from·to (고른 달은 닫힘)', async () => {
    const user = userEvent.setup();
    render(<PerformanceDashboard {...props({}, { sel: '2025-02' })} />);
    const presets = screen.getByRole('group', { name: '기간 프리셋' });
    expect(
      within(presets)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['올해', '최근 3개월', '최근 1년', '전체']);
    // 올해 = 2025-01~2025-03 = 지금 기간
    expect(within(presets).getByRole('button', { name: '올해' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(presets).getByRole('button', { name: '전체' }));
    expect(lastHref()).toBe('/procurement?from=2024-01&to=2025-03');
    fireEvent.change(screen.getByLabelText('조회 시작월'), { target: { value: '2025-02' } });
    expect(lastHref()).toBe('/procurement?from=2025-02&to=2025-03');
    fireEvent.change(screen.getByLabelText('조회 종료월'), { target: { value: '2024-01' } });
    expect(lastHref()).toBe('/procurement?from=2024-01&to=2024-01');
  });

  it('월 슬라이더: 키보드로 옮기고 놓으면(keyup) 한 번 반영 — 배경 거래량 막대', () => {
    render(<PerformanceDashboard {...props()} />);
    const start = screen.getByRole('slider', { name: '조회 시작 월' });
    expect(document.querySelectorAll('[data-month-volume]').length).toBe(3);
    fireEvent.keyDown(start, { key: 'Home' });
    expect(navigation.replace).not.toHaveBeenCalled();
    fireEvent.keyUp(start, { key: 'Home' });
    expect(lastHref()).toBe('/procurement?from=2024-01&to=2025-03');
  });

  it('기준월 선택 → month (최근 달부터)', async () => {
    const user = userEvent.setup();
    render(<PerformanceDashboard {...props()} />);
    const select = screen.getByLabelText('기준월');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['2025년 3월', '2025년 2월', '2025년 1월', '2024년 1월']);
    await user.selectOptions(select, '2025-01');
    expect(query().get('month')).toBe('2025-01');
  });
});

describe('KPI 카드·월 실적 보고표 (원본 구성)', () => {
  it('KPI: 누적매출·점유율·경쟁사 대비·전년 대비 (억·만)', () => {
    render(<PerformanceDashboard {...props()} />);
    const kpis = document.querySelector<HTMLElement>('dl[aria-label="조회 기간 요약"]')!;
    expect(kpis).toBeTruthy();
    const terms = within(kpis)
      .getAllByRole('term')
      .map((t) => t.textContent);
    expect(terms).toEqual(['누적매출', '점유율', '경쟁사 대비', '전년 대비']);
    const cards = Object.fromEntries(
      [...document.querySelectorAll('[data-kpi]')].map((card) => [
        card.getAttribute('data-kpi'),
        card.querySelectorAll('dd')[0]!.textContent,
      ]),
    );
    expect(cards).toEqual({
      amount: '1억 2,000만',
      share: '60.0%',
      rival: '+35.0%p',
      yoy: '+100.0%',
    });
  });

  it('보고표: 제목·요약 카드 3개·자사 월별 매출 표 열(구분·연도·1..M월·누적·M+1..12월·총 합계)', () => {
    render(<PerformanceDashboard {...props()} />);
    const report = screen.getByTestId('monthly-report');
    expect(within(report).getByRole('heading', { level: 2 })).toHaveTextContent(
      '전체 25년 조달 3월 실적',
    );
    const summary = within(report).getByTestId('report-summary');
    expect(summary).toHaveTextContent('25년 3월 실적');
    expect(summary).toHaveTextContent('25년 3월 누적');
    expect(summary).toHaveTextContent('누적 전년 동기 대비');
    expect(summary).toHaveTextContent('100.0% 상승');
    const table = within(report).getByRole('table', { name: /펜타시큐리티 조달 월별 매출/ });
    const header = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(header).toEqual([
      '구분',
      '연도',
      '1월',
      '2월',
      '3월',
      '누적',
      ...Array.from({ length: 9 }, (_, i) => `${i + 4}월`),
      '총 합계',
    ]);
    const rows = within(table).getAllByRole('row');
    // 전년 행: 1월 60.0 (백만원 소수 1자리), 총 합계 60.0 / 올해 1월 120.0 / 증감 +60.0
    expect(rows[1]).toHaveTextContent('2024');
    expect(within(rows[2]!).getAllByRole('cell')[0]).toHaveTextContent('120.0');
    expect(within(rows[3]!).getAllByRole('cell')[0]).toHaveTextContent('+60.0');
    expect(report).toHaveTextContent('(단위: 백만원/월)');
  });

  it('제조사별 실적표 모달: 열 = 구분 · {M}월(수주 건수·금액·점유율) · 누적(같은 셋) · 전년 점유율(년기준) · 목표 점유율', async () => {
    const user = userEvent.setup();
    actions.report.mockResolvedValue({
      ok: true,
      data: [
        reportRow({
          key: OURS,
          isOurs: true,
          monthAmount: 0,
          ytdAmount: 120 * M,
          ytdContractCount: 2,
          previousYearAmount: 60 * M,
        }),
        reportRow({
          key: '가상인증',
          monthAmount: 50 * M,
          monthContractCount: 2,
          ytdAmount: 50 * M,
          ytdContractCount: 2,
        }),
        reportRow({
          key: '가상보안',
          ytdAmount: 30 * M,
          ytdContractCount: 1,
          previousYearAmount: 5 * M,
        }),
      ],
    });
    render(<PerformanceDashboard {...props()} />);
    await user.click(screen.getByRole('button', { name: '제조사별 실적표 ⤢' }));
    expect(actions.report).toHaveBeenCalledWith({ tab: 'ALL', group: null, month: '2025-03' });
    const dialog = await screen.findByRole('dialog', {
      name: '전체 25년 3월 제조사별 실적 (단위: 백만원)',
    });
    const table = await within(dialog).findByTestId('manufacturer-report-table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual([
      '구분',
      '3월',
      '3월 누적',
      '2024년점유율(년기준)',
      '2025년목표 점유율',
      '수주 건수',
      '금액',
      '점유율',
      '수주 건수',
      '금액',
      '점유율',
    ]);
    const ours = table.querySelector(`[data-report-row="m:${OURS}"]`)!;
    expect(
      within(ours as HTMLElement)
        .getAllByRole('cell')
        .map((td) => td.textContent),
    ).toEqual(['0', '0.0', '0.0%', '2', '120.0', '60.0%', '92.3%', '—']);
    expect(table.querySelector('[data-report-row="subtotal"]')).toHaveTextContent('소계');
  });
});

describe('콤보 차트 ↔ 제조사 표 강조 연동', () => {
  it('표에서 제조사를 누르면 URL mfr, 범례에서 누르면 같은 상태', async () => {
    const user = userEvent.setup();
    render(<PerformanceDashboard {...props()} />);
    const table = screen.getByTestId('manufacturer-table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['제조사', '누적매출 (백만원)', '점유율', '전년대비']);
    await user.click(within(table).getByRole('button', { name: '가상보안' }));
    expect(query().get('mfr')).toBe('m:가상보안');
    // 낙관적 표시: URL 이 따라오기 전에도 차트·표가 강조된다
    expect(within(table).getByRole('button', { name: '가상보안' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const legend = screen.getByRole('list', { name: '전체 월별 매출 추이 범례' });
    expect(within(legend).getByRole('button', { name: '가상보안' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(legend).getByRole('button', { name: '가상인증' }));
    expect(query().get('mfr')).toBe('m:가상인증');
  });

  it('URL 의 강조 → 표 행·범례·차트 선(다른 계열은 흐리게), 다시 누르면 해제', async () => {
    const user = userEvent.setup();
    render(<PerformanceDashboard {...props({}, { mfr: 'm:가상인증' })} />);
    expect(document.querySelector('[data-manufacturer-row="m:가상인증"]')).toHaveAttribute(
      'data-highlighted',
      'true',
    );
    expect(document.querySelector('[data-line="m:가상인증"]')).toHaveAttribute('opacity', '1');
    expect(document.querySelector('[data-line="m:가상보안"]')).toHaveAttribute('opacity', '0.15');
    await user.click(
      within(screen.getByTestId('manufacturer-table')).getByRole('button', { name: '가상인증' }),
    );
    expect(query().get('mfr')).toBeNull();
  });

  it('차트에 이름이 없는 제조사(상위 N 밖)는 "기타" 계열을 강조', () => {
    const base = props();
    const chart = {
      ...base.chart,
      series: [
        base.chart.series[0]!,
        base.chart.series[1]!,
        {
          manufacturer: null,
          isOurs: false,
          isOthers: true,
          memberCount: 1,
          amount: 30 * M,
          values: [30 * M, 0, 0],
        },
      ],
    };
    render(<PerformanceDashboard {...props({ chart }, { mfr: 'm:가상보안' })} />);
    expect(document.querySelector('[data-line="others"]')).toHaveAttribute('opacity', '1');
    expect(document.querySelector('[data-line="m:가상인증"]')).toHaveAttribute('opacity', '0.15');
    expect(screen.getByRole('button', { name: '기타 1개사' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('월 클릭 → 그 달 계약 목록 (서버 페이지네이션)', () => {
  it('차트에서 달을 고르면(Enter) sel, 페이지는 1', async () => {
    const user = userEvent.setup();
    render(<PerformanceDashboard {...props({}, { page: 1 })} />);
    const plot = screen.getByRole('group', { name: '전체 월별 매출 추이' });
    act(() => plot.focus());
    await user.keyboard('{ArrowRight}{Enter}');
    expect(lastHref()).toBe('/procurement?from=2025-01&to=2025-03&sel=2025-02');
  });

  it('계약 목록: 제목(제조사 · 월 · 건수 · 억·만), 원본 열, 금액 백만원, 이전/다음 링크, 닫기', async () => {
    const user = userEvent.setup();
    const p = props(
      {
        resolved: { ...props().resolved, sel: '2025-01' },
        contracts: {
          rows: [
            {
              id: 7,
              dlvrReqNo: 'R-1',
              changeOrd: '00',
              dlvrReqDate: '2025-01-15',
              product: 'WAPPLES',
              productGroup: null,
              itemId: 'T-001',
              itemName: '가상 방화벽 A',
              manufacturer: OURS,
              demandOrg: '가상기관',
              vendor: '가상상사',
              contractNo: 'C-1',
              quantity: '1',
              unitPrice: 100 * M,
              amount: 123_450_000,
            },
          ],
          total: 120,
          page: 2,
          pageCount: 3,
          amount: 1_234_000_000,
        },
      },
      { sel: '2025-01', page: 2, mfr: `m:${OURS}` },
    );
    render(<PerformanceDashboard {...p} />);
    const list = screen.getByTestId('month-contracts');
    expect(within(list).getByRole('heading', { level: 3 })).toHaveTextContent(
      '펜타시큐리티 · 25.01 계약 목록 (120건 · 12억 3,400만)',
    );
    const table = within(list).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual([
      '납품요구일자',
      '제조사',
      '납품요구번호',
      '수요기관',
      '계약번호',
      '물품식별명',
      '납품금액 (백만원)',
    ]);
    expect(within(table).getAllByRole('cell').at(-1)).toHaveTextContent('123.5');
    const pages = within(list).getByRole('navigation', { name: '계약 목록 페이지' });
    expect(pages).toHaveTextContent('2 / 3 페이지');
    expect(within(pages).getByRole('link', { name: '이전' })).toHaveAttribute(
      'href',
      `/procurement?from=2025-01&to=2025-03&sel=2025-01&mfr=m%3A%28%EC%A3%BC%29%ED%8E%9C%ED%83%80%EC%8B%9C%ED%81%90%EB%A6%AC%ED%8B%B0`,
    );
    expect(within(pages).getByRole('link', { name: '다음' }).getAttribute('href')).toContain(
      'page=3',
    );
    await user.click(within(list).getByRole('button', { name: '닫기 ✕' }));
    expect(query().get('sel')).toBeNull();
    expect(query().get('page')).toBeNull();
  });
});

describe('연도별 매출·점유율 + 더보기', () => {
  it('요약 표 2개(제조사·연도·합계 열) → 더보기 모달은 서버에서 전체를 가져온다', async () => {
    const user = userEvent.setup();
    const many = yearlyOf(
      [
        ['가상1', false, 40 * M, 80 * M],
        ['가상2', false, 20 * M, 40 * M],
        ['가상3', false, 10 * M, 20 * M],
        ['가상4', false, 5 * M, 10 * M],
        [OURS, true, 1 * M, 2 * M],
      ],
      8,
    );
    actions.yearly.mockResolvedValue({
      ok: true,
      data: yearlyOf(
        [
          ['가상1', false, 40 * M, 80 * M],
          ['가상2', false, 20 * M, 40 * M],
          ['가상3', false, 10 * M, 20 * M],
          ['가상4', false, 5 * M, 10 * M],
          ['가상5', false, 4 * M, 9 * M],
          ['가상6', false, 3 * M, 8 * M],
          ['가상7', false, 2 * M, 7 * M],
          [OURS, true, 1 * M, 2 * M],
        ],
        8,
      ),
    });
    render(<PerformanceDashboard {...props({ yearly: many })} />);
    const amount = document.querySelector('[data-yearly-table="amount"]') as HTMLElement;
    expect(
      within(amount)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['제조사', '2024', '2025', '합계']);
    expect(
      within(amount)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['가상1', '가상2', '가상3', '펜타시큐리티', '기타 4개사', '합계']);
    const share = document.querySelector('[data-yearly-table="share"]') as HTMLElement;
    expect(within(share).getAllByRole('row')[1]).toHaveTextContent('가상140.0%40.0%40.0%');
    await user.click(screen.getByRole('button', { name: '연도별 점유율 현황 더보기' }));
    expect(actions.yearly).toHaveBeenCalledWith({ tab: 'ALL', group: null });
    const dialog = await screen.findByRole('dialog', { name: '연도별 점유율 현황' });
    await waitFor(() =>
      expect(
        within(dialog)
          .getAllByRole('rowheader')
          .map((th) => th.textContent),
      ).toHaveLength(9),
    );
    expect(within(dialog).queryByText(/기타/)).toBeNull();
  });

  it('모달 조회 실패 → 오류 + 다시 시도', async () => {
    const user = userEvent.setup();
    actions.yearly.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INTERNAL', message: '실패했습니다' },
    });
    actions.yearly.mockResolvedValueOnce({ ok: true, data: props().yearly });
    render(<PerformanceDashboard {...props()} />);
    await user.click(screen.getByRole('button', { name: '연도별 매출액 비교 더보기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('실패했습니다');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    const dialog = screen.getByRole('dialog', { name: '연도별 매출액 비교' });
    await waitFor(() => expect(within(dialog).getAllByRole('rowheader')).toHaveLength(4));
  });
});

describe('접근성 기본·빈 상태', () => {
  it('조작 그룹·표 이름, 표 안 sr-only 는 relative 칸 안 (표 스크롤 밖으로 새지 않게)', () => {
    render(<PerformanceDashboard {...props({}, { mfr: 'm:가상보안' })} />);
    expect(screen.getByRole('region', { name: '조회 기간' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '제조사별 실적' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /전체 월별 매출 추이/ })).toBeInTheDocument();
    for (const node of document.querySelectorAll('td .sr-only, th .sr-only')) {
      expect(node.closest('td, th')!.className).toMatch(/\brelative\b/);
    }
    // 자사 행: 색 외에 "(자사)" 글자
    expect(
      within(screen.getByTestId('manufacturer-table')).getByRole('button', {
        name: /펜타시큐리티\s*\(자사\)/,
      }),
    ).toBeInTheDocument();
  });

  it('범위에 실적이 없으면 빈 상태(status) — 탭은 그대로', () => {
    render(<PerformanceDashboard {...props({ hasData: false }, { tab: 'D.AMO' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('D.AMO 조달 실적이 없습니다');
    expect(screen.getByRole('group', { name: '제품' })).toBeInTheDocument();
    expect(screen.queryByTestId('monthly-report')).toBeNull();
  });
});
