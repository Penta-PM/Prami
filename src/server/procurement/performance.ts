import 'server-only';

import { and, asc, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { procurementItems, procurementVProductDeliveries } from '@/db/schema/procurement';
import {
  ISIGN_PRODUCT_GROUPS,
  PROCUREMENT_PRODUCT_TABS,
  PROCUREMENT_PRODUCTS,
  isOurManufacturer,
  type IsignProductGroup,
  type ProcurementProductTab,
} from '@/lib/procurement/constants';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';
import {
  addMonths,
  assertPeriod,
  changeRate,
  countDistinct,
  countRows,
  inPeriod,
  monthOf,
  monthsBetween,
  pageSizeOf,
  pageWindow,
  parseMonth,
  previousYearPeriod,
  ratio,
  sumAmount,
  sumAmountWhere,
  isOursSql,
  type MonthKey,
  type MonthPeriod,
  type Paged,
} from './shared';

/**
 * 조달 실적 현황 (UI-5). 기준 데이터 = v_product_deliveries — 제외 안 된 납품요구를 (요구번호, 물품)당 **첫 변경차수** 1행(D-9)
 * + 등록(active)·'기타' 아닌 물품. 금액 = amount(납품금액, 원), 계약 건수 = 납품요구번호 수(distinct dlvr_req_no).
 * 제조사 = 그 행의 물품(items: item_id + product — 뷰와 같은 조인 키라 1:1).
 * 모든 합계·건수는 SQL 집계 — 반환은 월·제조사·연도 단위 요약뿐이고 원본 행은 계약 목록(페이지네이션)으로만 나간다.
 * 날짜(dlvr_req_date)가 없는 행은 기간 집계에서 빠진다.
 */

/** 제품 탭 + (iSIGN 일 때만) 세부 그룹 */
export type PerformanceScope = {
  product: ProcurementProductTab;
  /** iSIGN 세부 그룹 — product 가 iSIGN 이 아니면 무시 */
  group?: IsignProductGroup | null;
};

const v = procurementVProductDeliveries;
const i = procurementItems;

/** 뷰 행의 물품(제조사) — 뷰의 조인과 같은 (item_id, product) */
const ITEM_JOIN = and(eq(i.itemId, v.itemId), eq(i.product, v.product));

function scopeConditions(scope: PerformanceScope): SQL[] {
  if (!(PROCUREMENT_PRODUCT_TABS as readonly string[]).includes(scope.product))
    throw new RangeError(`알 수 없는 제품 탭: ${scope.product}`);
  if (scope.product === 'ALL') return [];
  const conditions: SQL[] = [eq(v.product, scope.product) as SQL];
  if (scope.product === 'iSIGN' && scope.group) {
    if (!(ISIGN_PRODUCT_GROUPS as readonly string[]).includes(scope.group))
      throw new RangeError(`알 수 없는 iSIGN 세부 그룹: ${scope.group}`);
    conditions.push(eq(v.productGroup, scope.group) as SQL);
  }
  return conditions;
}

const OURS = isOursSql(i.manufacturer);

type Totals = { amount: number; contractCount: number; deliveryCount: number; ourAmount: number };

const TOTAL_FIELDS = {
  amount: sumAmount(v.amount),
  contractCount: countDistinct(v.dlvrReqNo),
  deliveryCount: countRows(),
  ourAmount: sumAmountWhere(v.amount, OURS),
};

async function totalsOf(db: Db, conditions: SQL[]): Promise<Totals> {
  const [row] = await db
    .select(TOTAL_FIELDS)
    .from(v)
    .leftJoin(i, ITEM_JOIN)
    .where(and(...conditions));
  return row ?? { amount: 0, contractCount: 0, deliveryCount: 0, ourAmount: 0 };
}

// ── KPI ─────────────────────────────────────────────────────────────

export type PerformanceKpis = Totals & {
  /** 자사 점유율 (금액 기준, 0~1) — 합계 0 이면 null */
  ourShare: number | null;
  /** 같은 달 범위의 1년 전 */
  previous: Totals;
  /** 전년 대비 금액 증감률 — 전년 0 이면 null */
  amountChangeRate: number | null;
};

/** KPI 카드: 기간 합계·계약 건수·자사 금액·점유율, 전년 같은 기간 대비 */
export async function getPerformanceKpis(
  access: ProcurementAccess,
  db: Db,
  input: { scope: PerformanceScope; period: MonthPeriod },
): Promise<PerformanceKpis> {
  assertProcurementAccess(access, 'read');
  assertPeriod(input.period);
  const scope = scopeConditions(input.scope);
  const [current, previous] = await Promise.all([
    totalsOf(db, [...scope, inPeriod(v.dlvrReqDate, input.period)]),
    totalsOf(db, [...scope, inPeriod(v.dlvrReqDate, previousYearPeriod(input.period))]),
  ]);
  return {
    ...current,
    ourShare: ratio(current.ourAmount, current.amount),
    previous,
    amountChangeRate: changeRate(current.amount, previous.amount),
  };
}

// ── 월별 시리즈 (막대 + 누적선 콤보 차트) ─────────────────────────────

export type MonthlyPoint = {
  month: MonthKey;
  amount: number;
  contractCount: number;
  ourAmount: number;
  /** 기간 시작부터 이 달까지 누적 */
  cumulativeAmount: number;
  cumulativeOurAmount: number;
  /** 1년 전 같은 달 */
  previousAmount: number;
};

async function monthlyTotals(db: Db, conditions: SQL[]) {
  const month = monthOf(v.dlvrReqDate);
  return db
    .select({
      month,
      amount: TOTAL_FIELDS.amount,
      contractCount: TOTAL_FIELDS.contractCount,
      ourAmount: TOTAL_FIELDS.ourAmount,
    })
    .from(v)
    .leftJoin(i, ITEM_JOIN)
    .where(and(...conditions))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

/** 기간의 모든 달(실적 없는 달 = 0) — 금액·건수·자사·누적·전년 같은 달 */
export async function getMonthlySeries(
  access: ProcurementAccess,
  db: Db,
  input: { scope: PerformanceScope; period: MonthPeriod },
): Promise<MonthlyPoint[]> {
  assertProcurementAccess(access, 'read');
  assertPeriod(input.period);
  const scope = scopeConditions(input.scope);
  const previousPeriod = previousYearPeriod(input.period);
  const rows = await monthlyTotals(db, [
    ...scope,
    sql`(${inPeriod(v.dlvrReqDate, input.period)} or ${inPeriod(v.dlvrReqDate, previousPeriod)})`,
  ]);
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  let cumulativeAmount = 0;
  let cumulativeOurAmount = 0;
  return monthsBetween(input.period.from, input.period.to).map((month) => {
    const row = byMonth.get(month);
    const amount = row?.amount ?? 0;
    const ourAmount = row?.ourAmount ?? 0;
    cumulativeAmount += amount;
    cumulativeOurAmount += ourAmount;
    return {
      month,
      amount,
      contractCount: row?.contractCount ?? 0,
      ourAmount,
      cumulativeAmount,
      cumulativeOurAmount,
      previousAmount: byMonth.get(addMonths(month, -12))?.amount ?? 0,
    };
  });
}

export type MonthVolume = { month: MonthKey; amount: number; contractCount: number };

/**
 * 조회기간 슬라이더(월 모드)의 범위와 배경 히스토그램: 데이터가 있는 첫 달 ~ 마지막 달의 월별 거래량(빈 달 0).
 * 데이터가 없으면 months = [], first·last = null.
 */
export async function getMonthVolumes(
  access: ProcurementAccess,
  db: Db,
  input: { scope: PerformanceScope },
): Promise<{ first: MonthKey | null; last: MonthKey | null; months: MonthVolume[] }> {
  assertProcurementAccess(access, 'read');
  const rows = await monthlyTotals(db, [
    ...scopeConditions(input.scope),
    isNotNull(v.dlvrReqDate) as SQL,
  ]);
  if (rows.length === 0) return { first: null, last: null, months: [] };
  const first = rows[0]!.month;
  const last = rows.at(-1)!.month;
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  return {
    first,
    last,
    months: monthsBetween(first, last).map((month) => ({
      month,
      amount: byMonth.get(month)?.amount ?? 0,
      contractCount: byMonth.get(month)?.contractCount ?? 0,
    })),
  };
}

// ── 제조사별 실적 (전년 대비) ────────────────────────────────────────

export type ManufacturerPerformanceRow = {
  /** null = 제조사 미기재 */
  manufacturer: string | null;
  isOurs: boolean;
  amount: number;
  contractCount: number;
  /** 기간 합계 대비 점유율 (0~1) */
  share: number | null;
  previousAmount: number;
  changeRate: number | null;
};

export type ManufacturerPerformance = {
  rows: ManufacturerPerformanceRow[];
  total: { amount: number; contractCount: number; previousAmount: number };
};

/** 제조사별 실적 표: 기간 또는 전년 같은 기간에 실적이 있는 제조사, 금액 큰 순 */
export async function getManufacturerPerformance(
  access: ProcurementAccess,
  db: Db,
  input: { scope: PerformanceScope; period: MonthPeriod },
): Promise<ManufacturerPerformance> {
  assertProcurementAccess(access, 'read');
  assertPeriod(input.period);
  const scope = scopeConditions(input.scope);
  const current = inPeriod(v.dlvrReqDate, input.period);
  const previous = inPeriod(v.dlvrReqDate, previousYearPeriod(input.period));
  const [rows, totals] = await Promise.all([
    db
      .select({
        manufacturer: i.manufacturer,
        amount: sumAmountWhere(v.amount, current),
        contractCount:
          sql<number>`count(distinct ${v.dlvrReqNo}) filter (where ${current})::int`.mapWith(
            Number,
          ),
        previousAmount: sumAmountWhere(v.amount, previous),
      })
      .from(v)
      .leftJoin(i, ITEM_JOIN)
      .where(and(...scope, sql`(${current} or ${previous})`))
      .groupBy(i.manufacturer)
      .orderBy(sql`2 desc`, sql`4 desc`, asc(i.manufacturer)),
    totalsOf(db, [...scope, current]),
  ]);
  const previousTotal = rows.reduce((sum, row) => sum + row.previousAmount, 0);
  return {
    rows: rows.map((row) => ({
      manufacturer: row.manufacturer,
      isOurs: isOurManufacturer(row.manufacturer),
      amount: row.amount,
      contractCount: row.contractCount,
      share: ratio(row.amount, totals.amount),
      previousAmount: row.previousAmount,
      changeRate: changeRate(row.amount, row.previousAmount),
    })),
    total: {
      amount: totals.amount,
      contractCount: totals.contractCount,
      previousAmount: previousTotal,
    },
  };
}

// ── 월 실적 보고표 (기준월) ──────────────────────────────────────────

export type MonthlyReportRow = {
  /** 행 키: 제품(ALL 탭) / iSIGN 세부 그룹(iSIGN 탭) / 제조사(상세 모달). 합계 행은 total 에 */
  key: string | null;
  isOurs?: boolean;
  monthAmount: number;
  monthContractCount: number;
  /** 기준월이 속한 해 1월 ~ 기준월 누적 */
  ytdAmount: number;
  ytdContractCount: number;
  /** 1년 전 같은 달 */
  previousMonthAmount: number;
  /** 1년 전 1월 ~ 같은 달 누적 */
  previousYtdAmount: number;
  ourMonthAmount: number;
  ourYtdAmount: number;
  ytdChangeRate: number | null;
  /** 누적 금액 중 자사 비중 */
  ourYtdShare: number | null;
};

export type MonthlyReport = { month: MonthKey; rows: MonthlyReportRow[]; total: MonthlyReportRow };

function reportFields(month: MonthKey) {
  const { year } = parseMonth(month);
  const thisMonth = inPeriod(v.dlvrReqDate, { from: month, to: month });
  const ytd = inPeriod(v.dlvrReqDate, { from: `${year}-01`, to: month });
  const lastMonth = inPeriod(v.dlvrReqDate, previousYearPeriod({ from: month, to: month }));
  const lastYtd = inPeriod(v.dlvrReqDate, previousYearPeriod({ from: `${year}-01`, to: month }));
  return {
    fields: {
      monthAmount: sumAmountWhere(v.amount, thisMonth),
      monthContractCount:
        sql<number>`count(distinct ${v.dlvrReqNo}) filter (where ${thisMonth})::int`.mapWith(
          Number,
        ),
      ytdAmount: sumAmountWhere(v.amount, ytd),
      ytdContractCount:
        sql<number>`count(distinct ${v.dlvrReqNo}) filter (where ${ytd})::int`.mapWith(Number),
      previousMonthAmount: sumAmountWhere(v.amount, lastMonth),
      previousYtdAmount: sumAmountWhere(v.amount, lastYtd),
      ourMonthAmount: sumAmountWhere(v.amount, sql`(${thisMonth} and ${OURS})`),
      ourYtdAmount: sumAmountWhere(v.amount, sql`(${ytd} and ${OURS})`),
    },
    /** 행을 읽을 범위 — 올해 누적 또는 작년 누적 */
    range: sql`(${ytd} or ${lastYtd})`,
  };
}

type ReportSums = Omit<MonthlyReportRow, 'key' | 'isOurs' | 'ytdChangeRate' | 'ourYtdShare'>;

function reportRow(key: string | null, sums: ReportSums | undefined): MonthlyReportRow {
  const base: ReportSums = sums ?? {
    monthAmount: 0,
    monthContractCount: 0,
    ytdAmount: 0,
    ytdContractCount: 0,
    previousMonthAmount: 0,
    previousYtdAmount: 0,
    ourMonthAmount: 0,
    ourYtdAmount: 0,
  };
  return {
    key,
    ...base,
    ytdChangeRate: changeRate(base.ytdAmount, base.previousYtdAmount),
    ourYtdShare: ratio(base.ourYtdAmount, base.ytdAmount),
  };
}

/**
 * 월 실적 보고표: 기준월 실적·올해 누적·전년 같은 달·전년 누적·자사 금액.
 * 행 = ALL 탭이면 제품(WAPPLES·D.AMO·iSIGN), iSIGN 탭(세부 그룹 미선택)이면 세부 그룹, 그 밖에는 합계 행만.
 */
export async function getMonthlyReport(
  access: ProcurementAccess,
  db: Db,
  input: { scope: PerformanceScope; month: MonthKey },
): Promise<MonthlyReport> {
  assertProcurementAccess(access, 'read');
  parseMonth(input.month);
  const scope = scopeConditions(input.scope);
  const { fields, range } = reportFields(input.month);
  const where = and(...scope, range);
  const groupKeys: readonly string[] | null =
    input.scope.product === 'ALL'
      ? PROCUREMENT_PRODUCTS
      : input.scope.product === 'iSIGN' && !input.scope.group
        ? ISIGN_PRODUCT_GROUPS
        : null;
  const groupColumn = input.scope.product === 'ALL' ? v.product : v.productGroup;
  const [totalRow] = await db.select(fields).from(v).leftJoin(i, ITEM_JOIN).where(where);
  let rows: MonthlyReportRow[] = [];
  if (groupKeys) {
    const grouped = await db
      .select({ key: groupColumn, ...fields })
      .from(v)
      .leftJoin(i, ITEM_JOIN)
      .where(where)
      .groupBy(groupColumn);
    const byKey = new Map(grouped.map(({ key, ...sums }) => [key, sums]));
    rows = groupKeys.map((key) => reportRow(key, byKey.get(key)));
  }
  return { month: input.month, rows, total: reportRow(null, totalRow) };
}

/** 월 실적 보고표의 제조사별 상세 (모달): 기준월·누적·전년 — 올해 누적 금액 큰 순 */
export async function getMonthlyReportByManufacturer(
  access: ProcurementAccess,
  db: Db,
  input: { scope: PerformanceScope; month: MonthKey },
): Promise<MonthlyReportRow[]> {
  assertProcurementAccess(access, 'read');
  parseMonth(input.month);
  const { fields, range } = reportFields(input.month);
  const grouped = await db
    .select({ key: i.manufacturer, ...fields })
    .from(v)
    .leftJoin(i, ITEM_JOIN)
    .where(and(...scopeConditions(input.scope), range))
    .groupBy(i.manufacturer)
    .orderBy(sql`4 desc`, sql`7 desc`, asc(i.manufacturer));
  return grouped.map(({ key, ...sums }) => ({
    ...reportRow(key, sums),
    isOurs: isOurManufacturer(key),
  }));
}

// ── 월 계약 목록 (월 클릭) ───────────────────────────────────────────

export type MonthContractRow = {
  id: number;
  dlvrReqNo: string;
  changeOrd: string;
  dlvrReqDate: string | null;
  product: string;
  productGroup: string | null;
  itemId: string;
  itemName: string | null;
  manufacturer: string | null;
  demandOrg: string | null;
  vendor: string | null;
  contractNo: string | null;
  /** numeric — 문자열 그대로 */
  quantity: string | null;
  unitPrice: number | null;
  amount: number | null;
};

/** 그 달의 계약(납품요구) 목록 — 서버 페이지네이션, 날짜 최신·금액 큰 순. amount = 선택 범위 전체 합계 */
export async function getMonthContracts(
  access: ProcurementAccess,
  db: Db,
  input: {
    scope: PerformanceScope;
    month: MonthKey;
    /** 제조사 한정 (제조사별 표에서 연 경우) */
    manufacturer?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<Paged<MonthContractRow> & { amount: number }> {
  assertProcurementAccess(access, 'read');
  parseMonth(input.month);
  const pageSize = pageSizeOf(input.pageSize);
  const where = and(
    ...scopeConditions(input.scope),
    inPeriod(v.dlvrReqDate, { from: input.month, to: input.month }),
    ...(input.manufacturer !== undefined ? [eq(i.manufacturer, input.manufacturer) as SQL] : []),
  );
  const [counted] = await db
    .select({ total: countRows(), amount: sumAmount(v.amount) })
    .from(v)
    .leftJoin(i, ITEM_JOIN)
    .where(where);
  const total = counted?.total ?? 0;
  const { page, pageCount, offset } = pageWindow(total, input.page ?? 1, pageSize);
  const rows = await db
    .select({
      id: v.id,
      dlvrReqNo: v.dlvrReqNo,
      changeOrd: v.changeOrd,
      dlvrReqDate: v.dlvrReqDate,
      product: v.product,
      productGroup: v.productGroup,
      itemId: v.itemId,
      itemName: v.itemName,
      manufacturer: i.manufacturer,
      demandOrg: v.demandOrg,
      vendor: v.vendor,
      contractNo: v.contractNo,
      quantity: v.quantity,
      unitPrice: v.unitPrice,
      amount: v.amount,
    })
    .from(v)
    .leftJoin(i, ITEM_JOIN)
    .where(where)
    .orderBy(desc(v.dlvrReqDate), sql`${v.amount} desc nulls last`, asc(v.product), asc(v.id))
    .limit(pageSize)
    .offset(offset);
  return { rows, total, page, pageCount, pageSize, amount: counted?.amount ?? 0 };
}

// ── 연도별 매출·점유율 ──────────────────────────────────────────────

export type YearAmount = { year: number; amount: number; share: number | null };

export type YearlyPerformance = {
  /** 데이터가 있는 첫 해 ~ 마지막 해 (빈 해 포함, 오름차순) */
  years: number[];
  totals: {
    year: number;
    amount: number;
    contractCount: number;
    ourAmount: number;
    ourShare: number | null;
  }[];
  /** 전 기간 금액 큰 순. manufacturerLimit 이 있으면 그만큼만(더보기 모달은 null = 전부) */
  manufacturers: {
    manufacturer: string | null;
    isOurs: boolean;
    totalAmount: number;
    years: YearAmount[];
  }[];
  /** 제한 전 제조사 수 (더보기 표시용) */
  manufacturerCount: number;
};

/** 연도별 매출·점유율 표 (+ 연도별 선 차트) */
export async function getYearlyPerformance(
  access: ProcurementAccess,
  db: Db,
  input: { scope: PerformanceScope; manufacturerLimit?: number | null },
): Promise<YearlyPerformance> {
  assertProcurementAccess(access, 'read');
  const where = and(...scopeConditions(input.scope), isNotNull(v.dlvrReqDate) as SQL);
  const year = sql<number>`extract(year from ${v.dlvrReqDate})::int`.mapWith(Number);
  const [totals, cells] = await Promise.all([
    db
      .select({
        year,
        amount: TOTAL_FIELDS.amount,
        contractCount: TOTAL_FIELDS.contractCount,
        ourAmount: TOTAL_FIELDS.ourAmount,
      })
      .from(v)
      .leftJoin(i, ITEM_JOIN)
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ manufacturer: i.manufacturer, year, amount: TOTAL_FIELDS.amount })
      .from(v)
      .leftJoin(i, ITEM_JOIN)
      .where(where)
      .groupBy(i.manufacturer, sql`2`),
  ]);
  if (totals.length === 0)
    return { years: [], totals: [], manufacturers: [], manufacturerCount: 0 };
  const first = totals[0]!.year;
  const last = totals.at(-1)!.year;
  const years = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const totalByYear = new Map(totals.map((row) => [row.year, row]));
  const byManufacturer = new Map<string | null, Map<number, number>>();
  for (const cell of cells) {
    const entry = byManufacturer.get(cell.manufacturer) ?? new Map<number, number>();
    entry.set(cell.year, cell.amount);
    byManufacturer.set(cell.manufacturer, entry);
  }
  const manufacturers = [...byManufacturer.entries()]
    .map(([manufacturer, amounts]) => ({
      manufacturer,
      isOurs: isOurManufacturer(manufacturer),
      totalAmount: [...amounts.values()].reduce((sum, amount) => sum + amount, 0),
      years: years.map((y) => {
        const amount = amounts.get(y) ?? 0;
        return { year: y, amount, share: ratio(amount, totalByYear.get(y)?.amount ?? 0) };
      }),
    }))
    .sort(
      (a, b) =>
        b.totalAmount - a.totalAmount ||
        (a.manufacturer ?? '￿').localeCompare(b.manufacturer ?? '￿', 'ko'),
    );
  const limit = input.manufacturerLimit;
  return {
    years,
    totals: years.map((y) => {
      const row = totalByYear.get(y);
      const amount = row?.amount ?? 0;
      const ourAmount = row?.ourAmount ?? 0;
      return {
        year: y,
        amount,
        contractCount: row?.contractCount ?? 0,
        ourAmount,
        ourShare: ratio(ourAmount, amount),
      };
    }),
    manufacturers:
      typeof limit === 'number' ? manufacturers.slice(0, Math.max(0, limit)) : manufacturers,
    manufacturerCount: manufacturers.length,
  };
}
