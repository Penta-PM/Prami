/**
 * 조달 차트 눈금·배치·집계 순수 함수 (조달이 통합 UI-4 — 조달이 TrendComboChart·YearlyTrendChart 의 계산을 옮김).
 * DOM·React 없음 — 단위 테스트 대상.
 */
import { formatEokMan, formatShare } from '@/lib/procurement/format';
import { formatMonthLong, type MonthKey } from '@/lib/month';

/** 0 부터 시작하는 "보기 좋은" 눈금 — 간격은 1·2·2.5·5 × 10^k. max ≤ 0 이면 [0, 1] (빈 차트도 축이 선다) */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ??
    10 * power;
  const last = Math.ceil(max / step - 1e-9);
  return Array.from({ length: last + 1 }, (_, index) => Number((index * step).toPrecision(12)));
}

/** [0, domainMax] → [rangeFrom, rangeTo] (선형). domainMax ≤ 0 이면 rangeFrom 고정 */
export function linearScale(domainMax: number, rangeFrom: number, rangeTo: number) {
  return (value: number) =>
    domainMax <= 0 ? rangeFrom : rangeFrom + (value / domainMax) * (rangeTo - rangeFrom);
}

/** n 칸 띠 — 칸 i 의 시작·중심. 칸 너비는 최소 0 */
export function bandLayout(count: number, start: number, width: number) {
  const bandWidth = count > 0 ? width / count : 0;
  return {
    bandWidth,
    left: (index: number) => start + bandWidth * index,
    center: (index: number) => start + bandWidth * (index + 0.5),
    /** 가로 좌표 → 칸 (범위 밖은 양 끝) */
    indexAt: (x: number) =>
      count === 0 ? 0 : Math.min(count - 1, Math.max(0, Math.floor((x - start) / bandWidth))),
  };
}

/** 누적 합 */
export function cumulative(values: readonly number[]): number[] {
  let run = 0;
  return values.map((value) => (run += value));
}

/**
 * x축 월 라벨 간격 — 12개월 이하면 매월, 길면 2개월, 칸이 좁으면 더 건너뛴다(조달이 원본 규칙).
 * 마지막 칸은 호출자가 항상 표시한다.
 */
export function monthTickStep(count: number, bandWidth: number): number {
  return Math.max(count <= 12 ? 1 : 2, bandWidth >= 46 ? 1 : bandWidth >= 24 ? 2 : 3);
}

/** x축 월 라벨 — 1월은 `2025년`, 첫 칸은 `25년 3월`, 나머지 `3월` */
export function monthAxisLabel(month: MonthKey, index: number): string {
  const mon = Number(month.slice(5, 7));
  if (mon === 1) return `${month.slice(0, 4)}년`;
  if (index === 0) return `${month.slice(2, 4)}년 ${mon}월`;
  return `${mon}월`;
}

/** 범례·툴팁 표시용 회사명 — 주식회사·(주)·㈜ 를 떼어 짧게 (집계 키는 원문 그대로) */
export function shortCompanyName(name: string): string {
  const short = name
    .replace(/주식회사|\(주\)|㈜/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return short || name;
}

// ── 콤보 차트 데이터 ─────────────────────────────────────────────

/** 콤보 차트 계열 — values 는 months 와 같은 길이(월별 금액, 원) */
export type ComboSeries = {
  key: string;
  /** 표시 이름(원문) */
  name: string;
  isOurs?: boolean;
  values: readonly number[];
};

/** 그리는 순서: 자사 먼저(막대 맨 아래 기준선), 나머지는 주어진 순서. 순번(rank)은 자사 제외 경쟁사 순번 */
export function orderSeries<T extends { isOurs?: boolean }>(
  series: readonly T[],
): { item: T; rank: number }[] {
  const ours = series.filter((item) => item.isOurs);
  const rivals = series.filter((item) => !item.isOurs);
  return [
    ...ours.map((item) => ({ item, rank: 0 })),
    ...rivals.map((item, rank) => ({ item, rank })),
  ];
}

/** 월별 쌓은 막대 — 칸마다 [아래, 위) 금액 구간. 0 이하 금액은 건너뛴다 */
export function stackSegments(
  series: readonly ComboSeries[],
  monthCount: number,
): { key: string; index: number; from: number; to: number; amount: number }[][] {
  return Array.from({ length: monthCount }, (_, index) => {
    let top = 0;
    const segments: { key: string; index: number; from: number; to: number; amount: number }[] = [];
    for (const item of series) {
      const amount = item.values[index] ?? 0;
      if (amount <= 0) continue;
      segments.push({ key: item.key, index, from: top, to: top + amount, amount });
      top += amount;
    }
    return segments;
  });
}

/** 월별 합계 */
export function monthTotals(series: readonly ComboSeries[], monthCount: number): number[] {
  return Array.from({ length: monthCount }, (_, index) =>
    series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
  );
}

/** 차트 요약 문장 (role="img" aria-label · 펼침 요약) — 금액은 억·만(D-3) */
export function comboSummary(
  title: string,
  months: readonly MonthKey[],
  series: readonly ComboSeries[],
): string {
  if (months.length === 0) return `${title}. 표시할 기간이 없습니다.`;
  const totals = monthTotals(series, months.length);
  const total = totals.reduce((sum, value) => sum + value, 0);
  const period = `${formatMonthLong(months[0]!)}~${formatMonthLong(months.at(-1)!)} ${months.length}개월`;
  if (total <= 0) return `${title}. ${period}, 실적이 없습니다.`;
  const peak = totals.reduce((best, value, index) => (value > totals[best]! ? index : best), 0);
  const parts = [
    `${title}. ${period}, 합계 ${formatEokMan(total)}.`,
    `월 최고 ${formatMonthLong(months[peak]!)} ${formatEokMan(totals[peak])}.`,
  ];
  const ours = series.find((item) => item.isOurs);
  if (ours) {
    const ourTotal = ours.values.reduce((sum, value) => sum + value, 0);
    parts.push(
      `자사(${shortCompanyName(ours.name)}) 누적 ${formatEokMan(ourTotal)}, 점유율 ${formatShare(ourTotal / total)}.`,
    );
  }
  if (series.length > 1) parts.push(`${series.length}개 계열.`);
  return parts.join(' ');
}

// ── 연도별 선 차트 데이터 ─────────────────────────────────────────

export type YearlyPoint = { month: MonthKey; amount: number };

export type YearLine = {
  year: string;
  /** 1~12월 칸 — 데이터가 없는 달(입력에 없음)은 null */
  points: ({ month: number; amount: number; cumulative: number } | null)[];
};

/**
 * 월 금액 → 연도별 1~12월 선 — 칸마다 월 금액과 연초부터 누적(조달이 원본은 누적을 그린다)을 함께 둔다.
 * 입력에 없는 달은 null(선이 끊긴다). 같은 달이 여러 번 오면 더한다. 연도 오름차순.
 */
export function buildYearLines(points: readonly YearlyPoint[]): YearLine[] {
  const byYear = new Map<string, Map<number, number>>();
  for (const point of points) {
    const year = point.month.slice(0, 4);
    const month = Number(point.month.slice(5, 7));
    const months = byYear.get(year) ?? new Map<number, number>();
    months.set(month, (months.get(month) ?? 0) + point.amount);
    byYear.set(year, months);
  }
  return [...byYear.keys()].sort().map((year) => {
    const months = byYear.get(year)!;
    let run = 0;
    return {
      year,
      points: Array.from({ length: 12 }, (_, index) => {
        const amount = months.get(index + 1);
        if (amount === undefined) return null;
        run += amount;
        return { month: index + 1, amount, cumulative: run };
      }),
    };
  });
}

export function yearlySummary(title: string, lines: readonly YearLine[]): string {
  if (lines.length === 0) return `${title}. 표시할 연도가 없습니다.`;
  const totals = lines.map((line) => {
    const last = [...line.points].reverse().find((point) => point !== null);
    return `${line.year}년 ${formatEokMan(last?.cumulative ?? 0)}`;
  });
  const range =
    lines.length === 1 ? `${lines[0]!.year}년` : `${lines[0]!.year}~${lines.at(-1)!.year}년`;
  return `${title}. ${range} ${lines.length}개 연도, 연간 누적 ${totals.join(', ')}.`;
}
