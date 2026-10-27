import { describe, expect, it } from 'vitest';

import {
  bandLayout,
  buildYearLines,
  chartKeyTarget,
  comboSummary,
  cumulative,
  linearScale,
  monthAxisLabel,
  monthTickStep,
  monthTotals,
  niceTicks,
  orderSeries,
  seriesColor,
  seriesMarker,
  shortCompanyName,
  stackSegments,
  yearlySummary,
} from '@/features/procurement/charts';
import {
  formatMonthDot,
  formatMonthLong,
  formatMonthShort,
  isMonthKey,
  monthRange,
  nearestMonthIndex,
  shiftMonth,
} from '@/lib/month';

/** 조달이 통합 UI-4 — 차트 눈금·배치·집계 순수 함수 (합성 값만) */

describe('월 키 헬퍼 (lib/month)', () => {
  it('형식·이동·범위·표기', () => {
    expect(isMonthKey('2025-03')).toBe(true);
    expect(isMonthKey('2025-13')).toBe(false);
    expect(shiftMonth('2025-11', 3)).toBe('2026-02');
    expect(shiftMonth('2025-01', -1)).toBe('2024-12');
    expect(monthRange('2024-11', '2025-02')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
    expect(monthRange('2025-03', '2025-01')).toEqual([]);
    expect(() => monthRange('2025-3', '2025-04')).toThrow(RangeError);
    expect(formatMonthDot('2025-03')).toBe('2025.03');
    expect(formatMonthShort('2025-03')).toBe('25.03');
    expect(formatMonthLong('2025-03')).toBe('2025년 3월');
  });

  it('nearestMonthIndex — 정확히 있으면 그 칸, 사이면 앞 칸, 밖이면 양 끝', () => {
    const months = ['2025-01', '2025-02', '2025-05'];
    expect(nearestMonthIndex(months, '2025-02')).toBe(1);
    expect(nearestMonthIndex(months, '2025-03')).toBe(1);
    expect(nearestMonthIndex(months, '2024-06')).toBe(0);
    expect(nearestMonthIndex(months, '2026-01')).toBe(2);
    expect(nearestMonthIndex([], '2026-01')).toBe(0);
  });
});

describe('눈금·축척', () => {
  it('niceTicks — 0부터, 1·2·2.5·5 간격, 마지막 눈금 ≥ 최댓값', () => {
    expect(niceTicks(10)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(11)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(1_234_000_000)).toEqual([0, 500_000_000, 1_000_000_000, 1_500_000_000]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(-5)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
    for (const max of [3, 7, 99, 101, 4_321, 98_765_432]) {
      const ticks = niceTicks(max);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)!).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBeLessThanOrEqual(6);
    }
  });

  it('linearScale — 0 → 기준선, 최대 → 위, 정의역 0 이면 기준선 고정', () => {
    const y = linearScale(100, 300, 20);
    expect(y(0)).toBe(300);
    expect(y(100)).toBe(20);
    expect(y(50)).toBe(160);
    expect(linearScale(0, 300, 20)(10)).toBe(300);
  });

  it('bandLayout — 칸 시작·중심, x → 칸(밖은 양 끝)', () => {
    const band = bandLayout(4, 100, 400);
    expect(band.bandWidth).toBe(100);
    expect(band.left(1)).toBe(200);
    expect(band.center(0)).toBe(150);
    expect(band.indexAt(250)).toBe(1);
    expect(band.indexAt(0)).toBe(0);
    expect(band.indexAt(9999)).toBe(3);
    expect(bandLayout(0, 0, 100).indexAt(50)).toBe(0);
  });

  it('x축 월 라벨 간격·문구 (조달이 원본 규칙)', () => {
    expect(monthTickStep(12, 50)).toBe(1);
    expect(monthTickStep(24, 50)).toBe(2);
    expect(monthTickStep(12, 30)).toBe(2);
    expect(monthTickStep(36, 10)).toBe(3);
    expect(monthAxisLabel('2025-01', 3)).toBe('2025년');
    expect(monthAxisLabel('2025-04', 0)).toBe('25년 4월');
    expect(monthAxisLabel('2025-04', 2)).toBe('4월');
  });

  it('chartKeyTarget — ←→ 1칸, PageUp/Down 12칸, Home/End, Esc = null, 처음엔 ← 끝·→ 처음', () => {
    expect(chartKeyTarget('ArrowRight', 2, 24)).toBe(3);
    expect(chartKeyTarget('ArrowLeft', 0, 24)).toBe(0);
    expect(chartKeyTarget('ArrowRight', 23, 24)).toBe(23);
    expect(chartKeyTarget('ArrowRight', null, 24)).toBe(0);
    expect(chartKeyTarget('ArrowLeft', null, 24)).toBe(23);
    expect(chartKeyTarget('PageDown', 5, 24)).toBe(17);
    expect(chartKeyTarget('PageUp', 5, 24)).toBe(0);
    expect(chartKeyTarget('Home', 9, 24)).toBe(0);
    expect(chartKeyTarget('End', 0, 24)).toBe(23);
    expect(chartKeyTarget('Escape', 3, 24)).toBeNull();
    expect(chartKeyTarget('a', 3, 24)).toBeUndefined();
    expect(chartKeyTarget('ArrowRight', null, 0)).toBeUndefined();
  });
});

describe('계열 집계', () => {
  const series = [
    { key: 'b', name: '가나 주식회사', values: [100, 0, 300] },
    { key: 'ours', name: '(주)자사테스트', isOurs: true, values: [50, 50, 0] },
    { key: 'c', name: '다라㈜', values: [0, 20, 10] },
  ];

  it('cumulative·monthTotals', () => {
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
    expect(monthTotals(series, 3)).toEqual([150, 70, 310]);
  });

  it('orderSeries — 자사 먼저, 경쟁사 순번은 자사 제외 0부터', () => {
    expect(orderSeries(series).map(({ item, rank }) => `${item.key}:${rank}`)).toEqual([
      'ours:0',
      'b:0',
      'c:1',
    ]);
  });

  it('stackSegments — 주어진 순서로 쌓고 0 은 건너뛴다', () => {
    const stacks = stackSegments(
      orderSeries(series).map(({ item }) => item),
      3,
    );
    expect(stacks[0]).toEqual([
      { key: 'ours', index: 0, from: 0, to: 50, amount: 50 },
      { key: 'b', index: 0, from: 50, to: 150, amount: 100 },
    ]);
    expect(stacks[1]!.map((segment) => segment.key)).toEqual(['ours', 'c']);
    expect(stacks[2]!.at(-1)).toEqual({ key: 'c', index: 2, from: 300, to: 310, amount: 10 });
  });

  it('shortCompanyName — 주식회사·(주)·㈜ 제거', () => {
    expect(shortCompanyName('가나 주식회사')).toBe('가나');
    expect(shortCompanyName('(주)자사테스트')).toBe('자사테스트');
    expect(shortCompanyName('다라㈜')).toBe('다라');
    expect(shortCompanyName('㈜')).toBe('㈜');
  });

  it('comboSummary — 기간·합계·최고 월·자사 누적·점유율 (억·만)', () => {
    const months = ['2025-01', '2025-02', '2025-03'];
    const big = series.map((item) => ({
      ...item,
      values: item.values.map((value) => value * 1_000_000),
    }));
    expect(comboSummary('월별 매출 추이', months, big)).toBe(
      '월별 매출 추이. 2025년 1월~2025년 3월 3개월, 합계 5억 3,000만. 월 최고 2025년 3월 3억 1,000만. 자사(자사테스트) 누적 1억, 점유율 18.9%. 3개 계열.',
    );
    expect(comboSummary('t', [], [])).toBe('t. 표시할 기간이 없습니다.');
    expect(comboSummary('t', ['2025-01'], [{ key: 'a', name: 'a', values: [0] }])).toBe(
      't. 2025년 1월~2025년 1월 1개월, 실적이 없습니다.',
    );
  });

  it('buildYearLines — 연도별 1~12월, 누적, 없는 달 null, 같은 달 합산', () => {
    const lines = buildYearLines([
      { month: '2025-02', amount: 5 },
      { month: '2024-01', amount: 10 },
      { month: '2024-02', amount: 0 },
      { month: '2024-03', amount: 7 },
      { month: '2025-02', amount: 1 },
    ]);
    expect(lines.map((line) => line.year)).toEqual(['2024', '2025']);
    expect(lines[0]!.points.slice(0, 4)).toEqual([
      { month: 1, amount: 10, cumulative: 10 },
      { month: 2, amount: 0, cumulative: 10 },
      { month: 3, amount: 7, cumulative: 17 },
      null,
    ]);
    expect(lines[1]!.points[0]).toBeNull();
    expect(lines[1]!.points[1]).toEqual({ month: 2, amount: 6, cumulative: 6 });
    expect(yearlySummary('연도별', lines)).toBe(
      '연도별. 2024~2025년 2개 연도, 연간 누적 2024년 17원, 2025년 6원.',
    );
    expect(yearlySummary('연도별', [])).toBe('연도별. 표시할 연도가 없습니다.');
  });
});

describe('팔레트', () => {
  it('자사 = --accent-ours·원, 경쟁사 순번대로 기존 토큰, 넘치면 회색 — 표식은 서로 다르다', () => {
    expect(seriesColor(0, true)).toBe('var(--accent-ours)');
    expect(seriesColor(0)).toBe('var(--purple-500)');
    expect(seriesColor(3)).toBe('var(--red-500)');
    expect(seriesColor(9)).toBe('var(--gray-600)');
    expect(seriesMarker(0, true)).toBe('circle');
    const rivals = [0, 1, 2, 3, 4].map((rank) => seriesMarker(rank));
    expect(new Set(rivals).size).toBe(5);
    expect(rivals).not.toContain('circle');
  });
});
