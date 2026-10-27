/**
 * 조달 실적 현황 표시 계산 (조달이 통합 UI-5) — 순수 함수. 서버가 집계한 요약(server/procurement/performance)을
 * 조달이 원본 화면 구성(HeroStat·MonthlyPerformanceReport·ManufacturerTable·YearlyAmount/ShareMatrix)대로 다시 배열한다.
 * 원본 행을 다루지 않는다 — 입력은 제조사·월·연도 단위 합계뿐.
 */
import { monthRange, shiftMonth, type MonthKey } from '@/lib/month';
import { OUR_COMPANY_NAMES } from '@/lib/procurement/our-company';
import {
  manufacturerKey,
  OTHERS_KEY,
  UNKNOWN_MANUFACTURER_KEY,
} from '@/lib/procurement/performance-filter';
import { EMPTY_VALUE, formatChangeRate, formatEokMan, formatShare } from '@/lib/procurement/format';
import type {
  ManufacturerPerformance,
  MonthlyReportRow,
  MonthlySeriesByManufacturer,
  PerformanceKpis,
  YearlyPerformance,
} from '@/server/procurement/performance';

import { shortCompanyName, type ComboSeries } from '../charts/scale';

/** 제조사 미기재 표시 */
export const UNKNOWN_MANUFACTURER_LABEL = '제조사 미기재';

/** 자사 대표 이름 (실적 없는 자사 자리·보고표 제목) — 설정 목록 첫 이름 */
export const OUR_COMPANY_LABEL: string = OUR_COMPANY_NAMES[0];

export function displayName(manufacturer: string | null): string {
  return manufacturer === null ? UNKNOWN_MANUFACTURER_LABEL : shortCompanyName(manufacturer);
}

/** 분모 0 이면 null */
function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function changeRate(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous;
}

export type Tone = 'good' | 'bad' | null;

function toneOf(value: number | null): Tone {
  if (value === null || value === 0) return null;
  return value > 0 ? 'good' : 'bad';
}

/**
 * 상위 limit 개(자사는 항상 포함)만 남기고 나머지는 한 줄로 합친다 (조달이 원본 summarizeRows).
 * limit 이 없거나 행이 limit+1 개 이하이면 그대로(기타 1개사짜리 줄은 의미가 없으므로).
 */
export function summarizeRows<T extends { isOurs: boolean }>(
  rows: readonly T[],
  limit: number | null,
  mergeRest: (rest: T[]) => T,
): T[] {
  if (!limit || rows.length <= limit + 1) return [...rows];
  const oursIndex = rows.findIndex((row) => row.isOurs);
  const keep =
    oursIndex >= limit ? [...rows.slice(0, limit - 1), rows[oursIndex]!] : rows.slice(0, limit);
  const rest = rows.filter((row) => !keep.includes(row));
  return [...keep, mergeRest(rest)];
}

// ── 제조사별 실적 표 (원본 ManufacturerTable) ─────────────────────────

export type ManufacturerTableRow = {
  key: string;
  manufacturer: string | null;
  label: string;
  isOurs: boolean;
  /** "기타 N개사" 요약 줄 */
  isEtc: boolean;
  amount: number;
  previousAmount: number;
};

/**
 * 기간 실적 표 행 — 기간에 계약이 있는 제조사 + 자사(없어도 0 으로, 원본: 비교 기준선), 금액 큰 순.
 * 전년에만 실적이 있는 제조사는 원본처럼 뺀다(전년 합계는 표의 전년 대비 계산에만 쓰인다).
 */
export function manufacturerTableRows(perf: ManufacturerPerformance): ManufacturerTableRow[] {
  const rows: ManufacturerTableRow[] = perf.rows
    .filter((row) => row.contractCount > 0 || row.isOurs)
    .map((row) => ({
      key: manufacturerKey(row.manufacturer),
      manufacturer: row.manufacturer,
      label: displayName(row.manufacturer),
      isOurs: row.isOurs,
      isEtc: false,
      amount: row.amount,
      previousAmount: row.previousAmount,
    }));
  if (!rows.some((row) => row.isOurs)) {
    rows.push({
      key: manufacturerKey(OUR_COMPANY_LABEL),
      manufacturer: OUR_COMPANY_LABEL,
      label: OUR_COMPANY_LABEL,
      isOurs: true,
      isEtc: false,
      amount: 0,
      previousAmount: 0,
    });
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

/** 제조사 표 요약 줄 수 (원본: 1~4위 + 기타) */
export const MANUFACTURER_TABLE_LIMIT = 4;
/** 제조사 표의 "기타 N개사" 요약 줄 키 — 누르면 펼친다(강조 키가 아니다) */
export const TABLE_ETC_KEY = 'table-etc';

export function summarizeManufacturerRows(rows: readonly ManufacturerTableRow[]) {
  return summarizeRows(rows, MANUFACTURER_TABLE_LIMIT, (rest) => ({
    key: TABLE_ETC_KEY,
    manufacturer: null,
    label: `기타 ${rest.length}개사`,
    isOurs: false,
    isEtc: true,
    amount: rest.reduce((sum, row) => sum + row.amount, 0),
    previousAmount: rest.reduce((sum, row) => sum + row.previousAmount, 0),
  }));
}

/** 전년 대비 — 전년 0 이면 올해 실적이 있을 때 "신규", 둘 다 0 이면 0% (원본) */
export function yoyText(amount: number, previousAmount: number): { text: string; tone: Tone } {
  if (previousAmount === 0)
    return amount > 0 ? { text: '신규', tone: null } : { text: '0.0%', tone: null };
  const rate = changeRate(amount, previousAmount);
  return { text: formatChangeRate(rate), tone: toneOf(rate) };
}

// ── KPI 카드 (원본 HeroStat: 누적매출 / 점유율 / 경쟁사 대비 / 전년 대비) ─────────────

export type KpiCard = {
  key: 'amount' | 'share' | 'rival' | 'yoy';
  label: string;
  value: string;
  sub: string;
  tone: Tone;
};

/** 점유율 차이(0~1 두 값의 차) → `+12.3%p` */
export function formatPointGap(gap: number | null): string {
  if (gap === null || !Number.isFinite(gap)) return EMPTY_VALUE;
  const points = Math.round(gap * 1000) / 10;
  if (points === 0) return '0.0%p';
  return `${points > 0 ? '+' : ''}${points.toFixed(1)}%p`;
}

/**
 * 조회 기간 KPI (원본 CompetitorLineChart 의 shareForPeriod·leaderGap·yoy):
 * - 누적매출 = 자사 기간 매출(억·만), 부가 = 시장 전체
 * - 점유율 = 자사 / 전체, 부가 = "N개사 중 M위" · "실적 없음" · "경쟁사 없음"
 * - 경쟁사 대비 = 자사 점유율 − 가장 큰 경쟁사 점유율(%p), 부가 = 그 경쟁사
 * - 전년 대비 = 같은 기간 1년 전 자사 매출 대비 증감률, 부가 = 전년 동기 자사 매출
 */
export function buildKpiCards(kpis: PerformanceKpis, perf: ManufacturerPerformance): KpiCard[] {
  const rows = manufacturerTableRows(perf);
  const total = kpis.amount;
  const ourShare = kpis.ourShare;
  const oursIndex = rows.findIndex((row) => row.isOurs);
  const rankLabel =
    total === 0
      ? '실적 없음'
      : rows.length <= 1
        ? '경쟁사 없음'
        : `${rows.length}개사 중 ${oursIndex + 1}위`;
  const rival = rows.find((row) => !row.isOurs && row.amount > 0) ?? null;
  const rivalShare = rival ? ratio(rival.amount, total) : null;
  const gap = total === 0 ? null : (ourShare ?? 0) - (rivalShare ?? 0);
  const yoy = changeRate(kpis.ourAmount, kpis.previous.ourAmount);
  return [
    {
      key: 'amount',
      label: '누적매출',
      value: formatEokMan(kpis.ourAmount),
      sub: `전체 ${formatEokMan(total)}`,
      tone: null,
    },
    { key: 'share', label: '점유율', value: formatShare(ourShare), sub: rankLabel, tone: null },
    {
      key: 'rival',
      label: '경쟁사 대비',
      value: formatPointGap(gap),
      sub: rival ? `${rival.label} ${formatShare(rivalShare)}` : '경쟁사 없음',
      tone: toneOf(gap),
    },
    {
      key: 'yoy',
      label: '전년 대비',
      value: yoy === null ? (kpis.ourAmount > 0 ? '신규' : EMPTY_VALUE) : formatChangeRate(yoy),
      sub: `전년 동기 ${formatEokMan(kpis.previous.ourAmount)}`,
      tone: toneOf(yoy),
    },
  ];
}

// ── 월 실적 보고표 (원본 MonthlyPerformanceReport) ────────────────────────

export type ReportSummaryCard = {
  label: string;
  value: string;
  share: string;
  prevLabel: string;
  prevValue: string;
  prevShare: string;
  growth: { text: string; tone: Tone };
};

function growthText(rate: number | null): { text: string; tone: Tone } {
  return { text: formatChangeRate(rate), tone: toneOf(rate) };
}

const yy = (year: number) => String(year).slice(2);

/**
 * 보고용 요약 (원본 summaryCards): "{yy}년 {M}월 실적" · "{yy}년 {M}월 누적" — 자사 금액(억·만)·점유율, 전년 같은 시점 비교,
 * 그리고 "누적 전년 동기 대비" 상승/하락. 자사 월 금액은 ourByMonth(getMonthlySeries 의 ourAmount), 시장 합계는 보고표 total.
 */
export function buildReportSummary(
  baseMonth: MonthKey,
  total: MonthlyReportRow,
  ourByMonth: ReadonlyMap<MonthKey, number>,
): { cards: ReportSummaryCard[]; cumulative: { rate: number | null; text: string; tone: Tone } } {
  const year = Number(baseMonth.slice(0, 4));
  const mon = Number(baseMonth.slice(5, 7));
  const prevBase = shiftMonth(baseMonth, -12);
  const ourSum = (months: MonthKey[]) =>
    months.reduce((sum, month) => sum + (ourByMonth.get(month) ?? 0), 0);
  const prevMonth = ourSum([prevBase]);
  const prevYtd = ourSum(monthRange(`${year - 1}-01`, prevBase));
  const cur = { m: total.ourMonthAmount, c: total.ourYtdAmount };
  const cards: ReportSummaryCard[] = [
    {
      label: `${yy(year)}년 ${mon}월 실적`,
      value: formatEokMan(cur.m),
      share: formatShare(ratio(cur.m, total.monthAmount)),
      prevLabel: `${yy(year - 1)}년 ${mon}월 실적`,
      prevValue: formatEokMan(prevMonth),
      prevShare: formatShare(ratio(prevMonth, total.previousMonthAmount)),
      growth: growthText(changeRate(cur.m, prevMonth)),
    },
    {
      label: `${yy(year)}년 ${mon}월 누적`,
      value: formatEokMan(cur.c),
      share: formatShare(ratio(cur.c, total.ytdAmount)),
      prevLabel: `${yy(year - 1)}년 ${mon}월 누적`,
      prevValue: formatEokMan(prevYtd),
      prevShare: formatShare(ratio(prevYtd, total.previousYtdAmount)),
      growth: growthText(changeRate(cur.c, prevYtd)),
    },
  ];
  const rate = changeRate(cur.c, prevYtd);
  const percent = rate === null ? null : Math.abs(Math.round(rate * 1000) / 10).toFixed(1);
  return {
    cards,
    cumulative: {
      rate,
      text: rate === null ? EMPTY_VALUE : `${percent}% ${rate >= 0 ? '상승' : '하락'}`,
      tone: rate === null ? null : rate >= 0 ? 'good' : 'bad',
    },
  };
}

export type OurMonthlyTable = {
  year: number;
  prevYear: number;
  /** 기준월까지 (1..M) */
  before: number[];
  /** 기준월 뒤 (M+1..12) */
  after: number[];
  baseMonthNumber: number;
  rows: {
    year: number;
    before: number[];
    ytd: number;
    /** 올해는 기준월 뒤 칸을 비운다(원본) */
    after: (number | null)[];
    full: number | null;
  }[];
  diff: { before: number[]; ytd: number };
};

/**
 * "자사 조달 월별 매출" 표 (원본 표 2): 열 = 구분 · 연도 · 1..M월 · 누적 · M+1..12월 · 총 합계, 행 = 전년 · 올해 · 증감.
 */
export function buildOurMonthlyTable(
  baseMonth: MonthKey,
  ourByMonth: ReadonlyMap<MonthKey, number>,
): OurMonthlyTable {
  const year = Number(baseMonth.slice(0, 4));
  const baseMonthNumber = Number(baseMonth.slice(5, 7));
  const prevYear = year - 1;
  const numbers = Array.from({ length: 12 }, (_, index) => index + 1);
  const before = numbers.filter((m) => m <= baseMonthNumber);
  const after = numbers.filter((m) => m > baseMonthNumber);
  const amount = (y: number, m: number) =>
    ourByMonth.get(`${y}-${String(m).padStart(2, '0')}`) ?? 0;
  const ytd = (y: number) => before.reduce((sum, m) => sum + amount(y, m), 0);
  const rows = [prevYear, year].map((y) => ({
    year: y,
    before: before.map((m) => amount(y, m)),
    ytd: ytd(y),
    after: after.map((m) => (y === prevYear ? amount(y, m) : null)),
    full: y === prevYear ? numbers.reduce((sum, m) => sum + amount(y, m), 0) : null,
  }));
  return {
    year,
    prevYear,
    before,
    after,
    baseMonthNumber,
    rows,
    diff: {
      before: before.map((m) => amount(year, m) - amount(prevYear, m)),
      ytd: ytd(year) - ytd(prevYear),
    },
  };
}

/** 제조사별 실적표(모달)에 이름으로 보일 경쟁사 수 — 나머지는 "기타(N개)" (원본 REPORT_OTHERS_COUNT) */
export const REPORT_OTHERS_COUNT = 6;

export type ManufacturerReportRow = {
  key: string;
  label: string;
  title: string;
  isOurs: boolean;
  isEtc: boolean;
  monthContractCount: number;
  monthAmount: number;
  ytdContractCount: number;
  ytdAmount: number;
  previousYearAmount: number;
};

/**
 * 제조사별 실적표 행 (원본 모달 표 1): 자사 먼저 → 경쟁사(누적 큰 순, 같으면 전년 큰 순) 상위 6 → "기타(N개)".
 * 기준월·누적·전년 한 해 실적이 모두 0 인 제조사는 뺀다(자사는 항상). 합계 = 소계 행.
 */
export function manufacturerReportRows(rows: readonly MonthlyReportRow[]): {
  rows: ManufacturerReportRow[];
  totals: Omit<ManufacturerReportRow, 'key' | 'label' | 'title' | 'isOurs' | 'isEtc'>;
} {
  const toRow = (row: MonthlyReportRow): ManufacturerReportRow => ({
    key: manufacturerKey(row.key),
    label: displayName(row.key),
    title: row.key ?? UNKNOWN_MANUFACTURER_LABEL,
    isOurs: !!row.isOurs,
    isEtc: false,
    monthContractCount: row.monthContractCount,
    monthAmount: row.monthAmount,
    ytdContractCount: row.ytdContractCount,
    ytdAmount: row.ytdAmount,
    previousYearAmount: row.previousYearAmount,
  });
  const stat = rows
    .map(toRow)
    .filter(
      (row) => row.isOurs || row.monthAmount > 0 || row.ytdAmount > 0 || row.previousYearAmount > 0,
    );
  const ours = stat.filter((row) => row.isOurs);
  if (ours.length === 0) {
    ours.push({
      key: manufacturerKey(OUR_COMPANY_LABEL),
      label: OUR_COMPANY_LABEL,
      title: OUR_COMPANY_LABEL,
      isOurs: true,
      isEtc: false,
      monthContractCount: 0,
      monthAmount: 0,
      ytdContractCount: 0,
      ytdAmount: 0,
      previousYearAmount: 0,
    });
  }
  const others = stat
    .filter((row) => !row.isOurs)
    .sort((a, b) => b.ytdAmount - a.ytdAmount || b.previousYearAmount - a.previousYearAmount);
  const sum = (list: ManufacturerReportRow[]) => ({
    monthContractCount: list.reduce((acc, row) => acc + row.monthContractCount, 0),
    monthAmount: list.reduce((acc, row) => acc + row.monthAmount, 0),
    ytdContractCount: list.reduce((acc, row) => acc + row.ytdContractCount, 0),
    ytdAmount: list.reduce((acc, row) => acc + row.ytdAmount, 0),
    previousYearAmount: list.reduce((acc, row) => acc + row.previousYearAmount, 0),
  });
  let tableRows = [...ours, ...others];
  if (others.length > REPORT_OTHERS_COUNT + 1) {
    const rest = others.slice(REPORT_OTHERS_COUNT);
    tableRows = [
      ...ours,
      ...others.slice(0, REPORT_OTHERS_COUNT),
      {
        key: OTHERS_KEY,
        label: `기타(${rest.length}개)`,
        title: `기타 ${rest.length}개 제조사`,
        isOurs: false,
        isEtc: true,
        ...sum(rest),
      },
    ];
  }
  return { rows: tableRows, totals: sum([...ours, ...others]) };
}

// ── 연도별 매출·점유율 (원본 YearlyAmountMatrix·YearlyShareMatrix) ──────────────

export type YearlyTableRow = {
  key: string;
  label: string;
  title: string;
  isOurs: boolean;
  isEtc: boolean;
  /** years 와 같은 순서 */
  amounts: number[];
  total: number;
};

/** 연도별 요약 줄 수 (원본: 상위 4 + 기타, 더보기 = 전체) */
export const YEARLY_SUMMARY_LIMIT = 4;

/**
 * 연도별 표 행. limit 가 있으면 요약(원본 summarizeRows — 상위 limit, 자사는 항상 + "기타 N개사"), 기타 금액 = 연도 합계 − 보인 행.
 * 서버는 manufacturerLimit = limit + 1 로 자른 목록(자사 포함 보장)과 manufacturerCount 만 준다(전량을 내리지 않음) —
 * 제조사가 limit + 1 개 이하면 기타 줄 없이 전부 보인다(기타 1개사짜리 줄은 의미가 없으므로, 원본과 같다).
 */
export function yearlyTableRows(yearly: YearlyPerformance, limit: number | null): YearlyTableRow[] {
  const rows: YearlyTableRow[] = yearly.manufacturers.map((row) => ({
    key: manufacturerKey(row.manufacturer),
    label: displayName(row.manufacturer),
    title: row.manufacturer ?? UNKNOWN_MANUFACTURER_LABEL,
    isOurs: row.isOurs,
    isEtc: false,
    amounts: row.years.map((cell) => cell.amount),
    total: row.totalAmount,
  }));
  if (!limit || yearly.manufacturerCount <= limit + 1) return rows;
  const oursIndex = rows.findIndex((row) => row.isOurs);
  const shown =
    oursIndex >= limit ? [...rows.slice(0, limit - 1), rows[oursIndex]!] : rows.slice(0, limit);
  const etcCount = yearly.manufacturerCount - shown.length;
  const etcAmounts = yearly.totals.map(
    (total, index) => total.amount - shown.reduce((sum, row) => sum + (row.amounts[index] ?? 0), 0),
  );
  return [
    ...shown,
    {
      key: OTHERS_KEY,
      label: `기타 ${etcCount}개사`,
      title: `기타 ${etcCount}개 제조사`,
      isOurs: false,
      isEtc: true,
      amounts: etcAmounts,
      total: etcAmounts.reduce((sum, value) => sum + value, 0),
    },
  ];
}

// ── 콤보 차트 계열 ↔ 제조사 표 강조 연동 ─────────────────────────────────

/** 서버 제조사별 월 시리즈 → ComboChart 계열 (키 = 강조 키 — 표 행과 같다) */
export function comboSeriesOf(data: MonthlySeriesByManufacturer): ComboSeries[] {
  return data.series.map((series) => ({
    key: series.isOthers ? OTHERS_KEY : manufacturerKey(series.manufacturer),
    name: series.isOthers
      ? `기타 ${series.memberCount}개사`
      : (series.manufacturer ?? UNKNOWN_MANUFACTURER_LABEL),
    isOurs: series.isOurs,
    values: series.values,
  }));
}

/**
 * 강조 상태(제조사 키 — 표 행 단위) → 차트 계열 키. 차트에 이름으로 없는 제조사(상위 N 밖)는 "기타" 계열로 비춘다.
 * 차트에 기타 계열도 없으면 null(강조 없음).
 */
export function chartHighlightKey(
  highlight: string | null,
  chartKeys: ReadonlySet<string>,
): string | null {
  if (highlight === null) return null;
  if (chartKeys.has(highlight)) return highlight;
  return chartKeys.has(OTHERS_KEY) ? OTHERS_KEY : null;
}

/** 표 행이 강조 상태에 해당하는가 — 행 자신이거나, "기타" 계열을 강조했고 이 행이 차트에서 기타에 묶인 경우 */
export function isRowHighlighted(
  rowKey: string,
  highlight: string | null,
  chartKeys: ReadonlySet<string>,
): boolean {
  if (highlight === null) return false;
  if (rowKey === highlight) return true;
  return (
    highlight === OTHERS_KEY &&
    rowKey !== OTHERS_KEY &&
    rowKey !== TABLE_ETC_KEY &&
    !chartKeys.has(rowKey)
  );
}

export { OTHERS_KEY, UNKNOWN_MANUFACTURER_KEY };
