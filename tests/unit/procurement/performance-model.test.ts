// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildKpiCards,
  buildOurMonthlyTable,
  buildReportSummary,
  chartHighlightKey,
  comboSeriesOf,
  formatPointGap,
  isRowHighlighted,
  manufacturerReportRows,
  manufacturerTableRows,
  summarizeManufacturerRows,
  summarizeRows,
  TABLE_ETC_KEY,
  yearlyTableRows,
  yoyText,
} from '@/features/procurement/performance/model';
import { OTHERS_KEY } from '@/lib/procurement/performance-filter';
import type {
  ManufacturerPerformance,
  MonthlyReportRow,
  PerformanceKpis,
  YearlyPerformance,
} from '@/server/procurement/performance';

/**
 * 조달이 통합 UI-5 — 실적 현황 표시 계산(원본 HeroStat·MonthlyPerformanceReport·ManufacturerTable·연도별 표 구성).
 * 값은 전부 합성(가짜 제조사·금액).
 */
const M = 1_000_000;
const OURS = '(주)펜타시큐리티';

function perf(
  rows: { name: string | null; amount: number; prev?: number; count?: number }[],
): ManufacturerPerformance {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return {
    rows: rows.map((row) => ({
      manufacturer: row.name,
      isOurs: row.name === OURS,
      amount: row.amount,
      contractCount: row.count ?? (row.amount > 0 ? 1 : 0),
      share: total ? row.amount / total : null,
      previousAmount: row.prev ?? 0,
      changeRate: null,
    })),
    total: { amount: total, contractCount: rows.length, previousAmount: 0 },
  };
}

function kpis(values: Partial<PerformanceKpis> & { previousOur?: number }): PerformanceKpis {
  const amount = values.amount ?? 0;
  const ourAmount = values.ourAmount ?? 0;
  return {
    amount,
    contractCount: 0,
    deliveryCount: 0,
    ourAmount,
    ourShare: amount ? ourAmount / amount : null,
    previous: { amount: 0, contractCount: 0, deliveryCount: 0, ourAmount: values.previousOur ?? 0 },
    amountChangeRate: null,
  };
}

describe('summarizeRows (원본 — 상위 N, 자사 항상, 기타 1개사 줄은 만들지 않음)', () => {
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, index) => ({
    name,
    isOurs: name === 'F',
    amount: 60 - index * 10,
  }));
  const merge = (rest: typeof rows) => ({
    name: `기타 ${rest.length}`,
    isOurs: false,
    amount: rest.reduce((sum, row) => sum + row.amount, 0),
  });

  it('자사가 범위 밖이면 마지막 자리를 자사로', () => {
    expect(summarizeRows(rows, 4, merge).map((row) => row.name)).toEqual([
      'A',
      'B',
      'C',
      'F',
      '기타 2',
    ]);
  });

  it('행이 limit+1 이하이거나 limit 없음 → 그대로', () => {
    expect(summarizeRows(rows.slice(0, 5), 4, merge)).toHaveLength(5);
    expect(summarizeRows(rows, null, merge)).toHaveLength(6);
  });
});

describe('KPI 카드 (원본 HeroStat: 누적매출·점유율·경쟁사 대비·전년 대비)', () => {
  it('억·만 금액, 점유율·순위, 1위 경쟁사와의 %p 차, 전년 대비', () => {
    const cards = buildKpiCards(
      kpis({ amount: 1_234_000_000, ourAmount: 617_000_000, previousOur: 400_000_000 }),
      perf([
        { name: OURS, amount: 617_000_000 },
        { name: '가상보안', amount: 417_000_000 },
        { name: '가상인증', amount: 200_000_000 },
      ]),
    );
    expect(cards.map((card) => card.label)).toEqual([
      '누적매출',
      '점유율',
      '경쟁사 대비',
      '전년 대비',
    ]);
    expect(cards[0]).toMatchObject({ value: '6억 1,700만', sub: '전체 12억 3,400만' });
    expect(cards[1]).toMatchObject({ value: '50.0%', sub: '3개사 중 1위' });
    // 50.0% − 33.8% = +16.2%p
    expect(cards[2]).toMatchObject({ value: '+16.2%p', sub: '가상보안 33.8%', tone: 'good' });
    expect(cards[3]).toMatchObject({ value: '+54.3%', sub: '전년 동기 4억', tone: 'good' });
  });

  it('실적 없음·경쟁사 없음·자사 0(목록에 없어도 순위에 들어감)·전년 0', () => {
    const empty = buildKpiCards(kpis({}), perf([]));
    expect(empty.map((card) => card.value)).toEqual(['0원', '—', '—', '—']);
    expect(empty[1]!.sub).toBe('실적 없음');
    const alone = buildKpiCards(
      kpis({ amount: 5 * M, ourAmount: 5 * M }),
      perf([{ name: OURS, amount: 5 * M }]),
    );
    expect(alone[1]!.sub).toBe('경쟁사 없음');
    expect(alone[3]!.value).toBe('신규');
    const behind = buildKpiCards(
      kpis({ amount: 10 * M, previousOur: 2 * M }),
      perf([{ name: '가상보안', amount: 10 * M }]),
    );
    expect(behind[1]!.sub).toBe('2개사 중 2위');
    expect(behind[2]).toMatchObject({ value: '-100.0%p', tone: 'bad' });
    expect(behind[3]).toMatchObject({ value: '-100.0%', tone: 'bad' });
  });

  it('formatPointGap', () => {
    expect(formatPointGap(0.1234)).toBe('+12.3%p');
    expect(formatPointGap(-0.05)).toBe('-5.0%p');
    expect(formatPointGap(0)).toBe('0.0%p');
    expect(formatPointGap(null)).toBe('—');
  });
});

describe('제조사별 실적 표 (원본 ManufacturerTable)', () => {
  const performance = perf([
    { name: '가상A', amount: 50 * M, prev: 25 * M },
    { name: OURS, amount: 40 * M, prev: 0 },
    { name: '가상B', amount: 30 * M, prev: 60 * M },
    { name: '가상C', amount: 20 * M },
    { name: '가상D', amount: 10 * M },
    { name: '가상E', amount: 5 * M },
    // 전년에만 실적 → 빠진다
    { name: '가상F', amount: 0, prev: 9 * M, count: 0 },
  ]);

  it('기간 실적 행(전년만 있는 회사 제외), 1~4위 + "기타 N개사"', () => {
    const rows = manufacturerTableRows(performance);
    expect(rows.map((row) => row.label)).toEqual([
      '가상A',
      '펜타시큐리티',
      '가상B',
      '가상C',
      '가상D',
      '가상E',
    ]);
    const summary = summarizeManufacturerRows(rows);
    expect(summary.map((row) => row.label)).toEqual([
      '가상A',
      '펜타시큐리티',
      '가상B',
      '가상C',
      '기타 2개사',
    ]);
    expect(summary.at(-1)).toMatchObject({ key: TABLE_ETC_KEY, isEtc: true, amount: 15 * M });
  });

  it('자사 실적이 없으면 0 행을 넣는다(원본 — 비교 기준선)', () => {
    const rows = manufacturerTableRows(perf([{ name: '가상A', amount: 5 * M }]));
    expect(rows.map((row) => [row.label, row.isOurs, row.amount])).toEqual([
      ['가상A', false, 5 * M],
      ['펜타시큐리티', true, 0],
    ]);
  });

  it('전년대비: 증감률 / 신규 / 0', () => {
    expect(yoyText(50, 25)).toEqual({ text: '+100.0%', tone: 'good' });
    expect(yoyText(30, 60)).toEqual({ text: '-50.0%', tone: 'bad' });
    expect(yoyText(40, 0)).toEqual({ text: '신규', tone: null });
    expect(yoyText(0, 0)).toEqual({ text: '0.0%', tone: null });
  });
});

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

describe('월 실적 보고표 (원본 MonthlyPerformanceReport)', () => {
  const ourByMonth = new Map([
    ['2025-01', 10 * M],
    ['2025-02', 20 * M],
    ['2025-03', 30 * M],
    ['2025-11', 5 * M],
    ['2026-01', 15 * M],
    ['2026-02', 0],
    ['2026-03', 45 * M],
  ]);

  it('요약: 기준월 실적·누적(자사 금액·점유율), 전년 같은 시점, 누적 전년 동기 대비', () => {
    const total = reportRow({
      monthAmount: 90 * M,
      ytdAmount: 120 * M,
      previousMonthAmount: 60 * M,
      previousYtdAmount: 100 * M,
      ourMonthAmount: 45 * M,
      ourYtdAmount: 60 * M,
    });
    const { cards, cumulative } = buildReportSummary('2026-03', total, ourByMonth);
    expect(cards[0]).toEqual({
      label: '26년 3월 실적',
      value: '4,500만',
      share: '50.0%',
      prevLabel: '25년 3월 실적',
      prevValue: '3,000만',
      prevShare: '50.0%',
      growth: { text: '+50.0%', tone: 'good' },
    });
    expect(cards[1]).toMatchObject({
      label: '26년 3월 누적',
      value: '6,000만',
      share: '50.0%',
      prevValue: '6,000만',
      prevShare: '60.0%',
      growth: { text: '0.0%', tone: null },
    });
    expect(cumulative).toEqual({ rate: 0, text: '0.0% 상승', tone: 'good' });
    const down = buildReportSummary('2026-02', reportRow({ ourYtdAmount: 15 * M }), ourByMonth);
    expect(down.cumulative.text).toBe('50.0% 하락');
    expect(buildReportSummary('2026-02', reportRow({}), new Map()).cumulative.text).toBe('—');
  });

  it('자사 월별 매출 표: 열 = 1..M월 · 누적 · M+1..12월 · 총 합계, 올해 기준월 뒤는 비움, 증감', () => {
    const table = buildOurMonthlyTable('2026-03', ourByMonth);
    expect(table.before).toEqual([1, 2, 3]);
    expect(table.after).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(table.rows[0]).toMatchObject({
      year: 2025,
      before: [10 * M, 20 * M, 30 * M],
      ytd: 60 * M,
      full: 65 * M,
    });
    expect(table.rows[0]!.after[7]).toBe(5 * M);
    expect(table.rows[1]).toMatchObject({ year: 2026, ytd: 60 * M, full: null });
    expect(table.rows[1]!.after.every((cell) => cell === null)).toBe(true);
    expect(table.diff).toEqual({ before: [5 * M, -20 * M, 15 * M], ytd: 0 });
  });

  it('제조사별 실적표 행: 자사 먼저, 경쟁사 누적 큰 순(같으면 전년) 상위 6 + "기타(N개)", 전부 0 인 회사 제외, 소계', () => {
    const rows = [
      reportRow({
        key: '가상1',
        ytdAmount: 70 * M,
        monthAmount: 7 * M,
        monthContractCount: 1,
        ytdContractCount: 3,
      }),
      reportRow({ key: OURS, isOurs: true, ytdAmount: 10 * M, previousYearAmount: 4 * M }),
      ...[2, 3, 4, 5, 6, 7, 8].map((n) =>
        reportRow({ key: `가상${n}`, ytdAmount: (10 - n) * M, previousYearAmount: n }),
      ),
      reportRow({ key: '가상9', ytdAmount: 1 * M, previousYearAmount: 99 }),
      reportRow({ key: '가상0' }),
    ];
    const { rows: table, totals } = manufacturerReportRows(rows);
    expect(table.map((row) => row.label)).toEqual([
      '펜타시큐리티',
      '가상1',
      '가상2',
      '가상3',
      '가상4',
      '가상5',
      '가상6',
      '기타(3개)',
    ]);
    expect(table.at(-1)).toMatchObject({ key: OTHERS_KEY, isEtc: true, ytdAmount: 6 * M });
    expect(totals).toEqual({
      monthContractCount: 1,
      monthAmount: 7 * M,
      ytdContractCount: 3,
      ytdAmount: 116 * M,
      previousYearAmount: 4 * M + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 99,
    });
    // 경쟁사가 7개 이하이면 기타 없이 전부
    expect(manufacturerReportRows(rows.slice(0, 5)).rows.some((row) => row.isEtc)).toBe(false);
  });
});

describe('연도별 표 요약 (원본 YearlyAmount/ShareMatrix + 더보기)', () => {
  const yearly = (count: number, names: { name: string; ours?: boolean; amounts: number[] }[]) =>
    ({
      years: [2024, 2025],
      totals: [
        { year: 2024, amount: 100, contractCount: 0, ourAmount: 0, ourShare: null },
        { year: 2025, amount: 200, contractCount: 0, ourAmount: 0, ourShare: null },
      ],
      manufacturers: names.map(({ name, ours, amounts }) => ({
        manufacturer: name,
        isOurs: !!ours,
        totalAmount: amounts[0]! + amounts[1]!,
        years: [
          { year: 2024, amount: amounts[0]!, share: null },
          { year: 2025, amount: amounts[1]!, share: null },
        ],
      })),
      manufacturerCount: count,
    }) satisfies YearlyPerformance;

  const five = [
    { name: '가상1', amounts: [40, 80] },
    { name: '가상2', amounts: [20, 40] },
    { name: '가상3', amounts: [10, 20] },
    { name: '가상4', amounts: [5, 10] },
    { name: OURS, ours: true, amounts: [1, 2] },
  ];

  it('제조사 > limit+1 이면 상위(자사 포함) + "기타 N개사" — 기타 금액 = 연도 합계 − 보인 행', () => {
    const rows = yearlyTableRows(yearly(9, five), 4);
    expect(rows.map((row) => row.label)).toEqual([
      '가상1',
      '가상2',
      '가상3',
      '펜타시큐리티',
      '기타 5개사',
    ]);
    expect(rows.at(-1)).toMatchObject({ isEtc: true, amounts: [100 - 71, 200 - 142], total: 87 });
  });

  it('제조사 ≤ limit+1 이면 기타 줄 없이 전부, limit 없음(더보기) = 전부', () => {
    expect(yearlyTableRows(yearly(5, five), 4)).toHaveLength(5);
    expect(yearlyTableRows(yearly(5, five), null).map((row) => row.isEtc)).not.toContain(true);
  });
});

describe('콤보 차트 계열 ↔ 제조사 표 강조 연동', () => {
  const series = comboSeriesOf({
    months: ['2025-01'],
    manufacturerCount: 4,
    amount: 10,
    series: [
      { manufacturer: OURS, isOurs: true, isOthers: false, memberCount: 1, amount: 5, values: [5] },
      {
        manufacturer: '가상A',
        isOurs: false,
        isOthers: false,
        memberCount: 1,
        amount: 3,
        values: [3],
      },
      {
        manufacturer: null,
        isOurs: false,
        isOthers: false,
        memberCount: 1,
        amount: 1,
        values: [1],
      },
      { manufacturer: null, isOurs: false, isOthers: true, memberCount: 2, amount: 1, values: [1] },
    ],
  });
  const keys = new Set(series.map((item) => item.key));

  it('계열 키 = 표 행 키 (기타·미기재 구분)', () => {
    expect(series.map((item) => [item.key, item.name, !!item.isOurs])).toEqual([
      [`m:${OURS}`, OURS, true],
      ['m:가상A', '가상A', false],
      ['none', '제조사 미기재', false],
      [OTHERS_KEY, '기타 2개사', false],
    ]);
  });

  it('표에서 고른 회사가 차트에 이름으로 없으면 "기타" 계열을 강조, 기타를 고르면 거기 묶인 표 행이 강조', () => {
    expect(chartHighlightKey('m:가상A', keys)).toBe('m:가상A');
    expect(chartHighlightKey('m:가상Z', keys)).toBe(OTHERS_KEY);
    expect(chartHighlightKey(null, keys)).toBeNull();
    expect(chartHighlightKey('m:가상Z', new Set(['m:가상A']))).toBeNull();
    expect(isRowHighlighted('m:가상A', 'm:가상A', keys)).toBe(true);
    expect(isRowHighlighted('m:가상Z', OTHERS_KEY, keys)).toBe(true);
    expect(isRowHighlighted('m:가상A', OTHERS_KEY, keys)).toBe(false);
    expect(isRowHighlighted(TABLE_ETC_KEY, OTHERS_KEY, keys)).toBe(false);
    expect(isRowHighlighted('m:가상A', null, keys)).toBe(false);
  });
});
