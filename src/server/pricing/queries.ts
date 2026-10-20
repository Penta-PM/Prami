import { and, asc, count, desc, eq, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { ITEM_REMARK_HEADER } from '@/server/imports/schemas/items';
import { importBatches, items, salesPrices, type SalesPrice } from '@/db/schema';
import {
  PRICE_TYPE_NONE,
  priceFilterDefs,
  type PriceFilterId,
} from '@/features/pricing/column-filters';
import type { PriceFilter, PriceSortId } from '@/features/pricing/filter';
import { STATUS_ORDERS, type SortDir } from '@/lib/table/compare';
import { productFamilyMajors } from '@/lib/constants/product-cards';
import { ITEM_STATUS_UNKNOWN } from '@/lib/constants/item-status';

import { buildFilterSpec, filterSqlConditions } from '@/server/table/filter-sql';

import { dateConditions } from './date-filter';
import {
  LIVE_PRICE,
  PREVIOUS_PRICE,
  PREVIOUS_PRICE_JOIN,
  PRICE_CHANGE_AMOUNT,
  PRICE_CHANGE_RATE,
  previousPrices,
} from './price-change-sql';
import { buildOrderBy, byMoney, byStatus, byText, byValue, isEmptyText } from './sort-sql';

/** 조회·관리 표 (§4.5.3) — 서버 페이지네이션 50행, 기본 정렬 effective_from DESC, item_name (+ #32 열 정렬) */
export const PRICE_PAGE_SIZE = 50;

export type ItemStatusLabel = '임시' | '폐기' | '사용' | typeof ITEM_STATUS_UNKNOWN;

export type PriceRow = {
  id: number;
  priceType: string | null;
  major: string;
  mid: string | null;
  minor: string | null;
  itemCode: string;
  itemName: string;
  unitPrice: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  itemStatus: ItemStatusLabel;
  operationStatus: '운영중' | '미사용';
  remark: string | null;
  source: 'erp' | 'manual';
  /** 같은 계열(series_key)의 직전 적용시작일 행 판매가 (삭제 행 제외, 필터·페이지 무관). 첫 시기 = null */
  previousPrice: string | null;
  /** (현재 − 직전) / 직전 × 100, 소수 1자리 반올림(절댓값 기준 half-up). 첫 시기·직전가 0 = null */
  priceChangeRate: number | null;
};

export type PricePage = {
  rows: PriceRow[];
  total: number;
  page: number;
  pageCount: number;
};

/** 대분류 = items.category_major, 없으면 제품군 (§4.5.3) */
const MAJOR = sql<string>`coalesce(${items.categoryMajor}, ${salesPrices.productFamily})`;
/** 마스터에 없거나(stub) 매핑되지 않은 상태 → 미확인 (§4.3.2, AC-22) */
const ITEM_STATUS = sql<ItemStatusLabel>`coalesce(${items.itemStatus}::text, ${ITEM_STATUS_UNKNOWN})`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** 날짜 필터 SQL (§4.5.2) — 원가와 공용 규칙 */
export function dateCondition(filter: Pick<PriceFilter, 'dateMode' | 'from' | 'to'>): SQL[] {
  return dateConditions(salesPrices, filter);
}

/**
 * 가격 변동 (cost-ratio-price-change §2.4): 직전가는 **필터·페이지 적용 전** 전체(삭제 제외)에서 계열별 lag 로 구해
 * id 로 붙인다 — 직전 행이 다른 페이지·필터 밖이어도 같은 값. 식(직전가 윈도·변동률·삭제 제외)은 변동 이력 모달과 공용
 * (`./price-change-sql`, price-change-history-modal §2.1-2).
 */
const ALL_PREVIOUS_PRICES = previousPrices();

const ROW_FIELDS = {
  id: salesPrices.id,
  priceType: salesPrices.priceType,
  major: MAJOR,
  mid: items.categoryMid,
  minor: items.categoryMinor,
  itemCode: salesPrices.itemCode,
  itemName: salesPrices.itemName,
  unitPrice: salesPrices.unitPrice,
  currency: salesPrices.currency,
  effectiveFrom: salesPrices.effectiveFrom,
  effectiveTo: salesPrices.effectiveTo,
  itemStatus: ITEM_STATUS,
  operationStatus: salesPrices.operationStatus,
  remark: salesPrices.remark,
  source: salesPrices.source,
  previousPrice: PREVIOUS_PRICE,
  // pg·PGlite 모두 numeric 을 문자열로 준다 → number (NULL 은 매핑하지 않는다)
  priceChangeRate: PRICE_CHANGE_RATE.mapWith(Number),
};

/**
 * 가격 표 열 필터 id → 열 식 (표 열 필터 스펙 §2.3). 정렬 맵(PRICE_SORT_SQL)과 같은 식.
 * 가격 변동은 필터·페이지 전 전체에서 구한 lag(price_prev) 기준 변동률 — 필터는 이 값을 거를 뿐 직전가 계산에 영향이 없다.
 * enum 선택지 검증(통화 = 데이터)은 URL 파싱(parsePriceFilter + priceFilterDefs)에서 끝난다 — 여기서는 열·연산자 화이트리스트만.
 */
export const PRICE_FILTER_SQL: Record<PriceFilterId, AnyColumn | SQL> = {
  priceType: salesPrices.priceType,
  currency: salesPrices.currency,
  price: salesPrices.unitPrice,
  priceChange: PRICE_CHANGE_RATE,
  itemStatus: ITEM_STATUS,
  status: salesPrices.operationStatus,
  remark: salesPrices.remark,
};

const PRICE_FILTER_SPEC = buildFilterSpec(priceFilterDefs([]), PRICE_FILTER_SQL, {
  // 단가 유형 '— (없음)' = 빈 값(NULL·''·공백만·'—') — 표 칸 priceTypeLabel 의 '—' 와 같은 묶음
  emptyValues: { priceType: PRICE_TYPE_NONE },
});

function buildWhere(filter: PriceFilter): SQL | undefined {
  const conditions: SQL[] = [LIVE_PRICE, ...dateCondition(filter)];
  if (filter.major) conditions.push(sql`${MAJOR} = ${filter.major}`);
  else if (filter.family) {
    // 홈 카드 묶음 (예: iSIGN 카드 = iSIGN + iSIGN PKI, Q-10·PR-9 QA LOW-1). 모르는 값이면 결과 없음
    const majors = productFamilyMajors(filter.family) ?? [];
    conditions.push(
      majors.length > 0
        ? sql`${MAJOR} in (${sql.join(
            majors.map((major) => sql`${major}`),
            sql`, `,
          )})`
        : sql`false`,
    );
  }
  if (filter.mid) conditions.push(eq(items.categoryMid, filter.mid) as SQL);
  if (filter.minor) conditions.push(eq(items.categoryMinor, filter.minor) as SQL);
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q)}%`;
    // 품명 NBSP 는 검색 시에만 공백으로 정규화 (§4.3.1, R-10)
    conditions.push(
      sql`(replace(${salesPrices.itemName}, chr(160), ' ') ilike ${pattern} or ${salesPrices.itemCode} ilike ${pattern})`,
    );
  }
  // 열 필터 (표 열 필터 스펙 §2.3) — 분류·적용기간·검색과 같은 의미의 열은 화이트리스트에 없다
  conditions.push(...filterSqlConditions(filter.filters ?? [], PRICE_FILTER_SPEC));
  return and(...conditions);
}

/** 가격 변동 열 필터가 있으면 count 도 직전가 윈도를 조인해야 한다 */
function needsPreviousPrices(filter: PriceFilter): boolean {
  return (filter.filters ?? []).some((cond) => cond.col === 'priceChange');
}

/** 기본 정렬 (§4.5.3) — 정렬을 고르면 tie-breaker 로 그대로 뒤에 붙는다(stable, 끝은 id) */
const DEFAULT_ORDER: SQL[] = [
  desc(salesPrices.effectiveFrom),
  asc(salesPrices.itemName),
  asc(salesPrices.id),
];

/** 운영 연도 라벨(operationYearsLabel)의 연도: 시작 연도, 끝 연도 = 배타적 종료일 하루 전의 연도 (NULL = 현재) */
const START_YEAR = sql`extract(year from ${salesPrices.effectiveFrom})`;
const END_YEAR = sql`extract(year from (${salesPrices.effectiveTo} - 1))`;

/** 가격 표 정렬 id → ORDER BY 키 (#32 스펙 §2·§3). 화이트리스트 PRICE_SORT_IDS 와 1:1 */
export const PRICE_SORT_SQL: Record<PriceSortId, (dir: SortDir) => SQL[]> = {
  priceType: (dir) => byText(salesPrices.priceType, dir),
  major: (dir) => byText(MAJOR, dir),
  mid: (dir) => byText(items.categoryMid, dir),
  minor: (dir) => byText(items.categoryMinor, dir),
  itemName: (dir) => byText(salesPrices.itemName, dir),
  price: (dir) => byMoney(salesPrices.currency, salesPrices.unitPrice, dir),
  effectiveFrom: (dir) => [byValue(salesPrices.effectiveFrom, dir)],
  // 적용기간 = 시작일 기준, 같으면 종료일 (NULL = 현재 → NULLS LAST, 스펙 §2)
  period: (dir) => [byValue(salesPrices.effectiveFrom, dir), byValue(salesPrices.effectiveTo, dir)],
  // 표시 라벨 `시작 ~ 끝`/`시작 ~ 현재`/`시작` 의 문자열 순과 같다: 시작 연도 → 끝 연도(현재 = 맨 뒤)
  operationYears: (dir) => [byValue(START_YEAR, dir), byValue(END_YEAR, dir)],
  // 사용 → 임시 → 폐기 → 미확인 (스펙 §9.2 Q3)
  itemStatus: (dir) => byStatus(ITEM_STATUS, STATUS_ORDERS.partMapping, dir),
  status: (dir) => byStatus(salesPrices.operationStatus, STATUS_ORDERS.pricingState, dir),
  remark: (dir) => byText(salesPrices.remark, dir),
  // 가격 변동: 반올림한 변동률 숫자순, '—'(첫 시기·직전가 0) 은 방향과 관계없이 맨 뒤
  priceChange: (dir) => [byValue(PRICE_CHANGE_RATE, dir)],
};

/** getPriceRows (§4.7) — 원가 조인 없음. 가격 변동(직전가·변동률)은 전체 기준 윈도를 id 로 조인 */
export async function getPriceRows(db: Db, filter: PriceFilter): Promise<PricePage> {
  const where = buildWhere(filter);
  const countQuery = db
    .select({ total: count() })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .$dynamic();
  const [counted] = await (
    needsPreviousPrices(filter)
      ? countQuery.leftJoin(ALL_PREVIOUS_PRICES, PREVIOUS_PRICE_JOIN)
      : countQuery
  ).where(where);
  const total = counted?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PRICE_PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  const rows = await db
    .select(ROW_FIELDS)
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .leftJoin(ALL_PREVIOUS_PRICES, PREVIOUS_PRICE_JOIN)
    .where(where)
    .orderBy(...buildOrderBy(filter.sort, PRICE_SORT_SQL, DEFAULT_ORDER))
    .limit(PRICE_PAGE_SIZE)
    .offset((page - 1) * PRICE_PAGE_SIZE);
  return { rows, total, page, pageCount };
}

/** 통화 열 필터 선택지: 데이터에 있는 통화 코드 (삭제 제외, 오름차순) */
export async function listPriceCurrencies(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ currency: sql<string>`${salesPrices.currency}::text` })
    .from(salesPrices)
    .where(isNull(salesPrices.deletedAt))
    .orderBy(sql`1`);
  return rows.map((row) => row.currency);
}

/**
 * 단가 유형 열 필터 선택지 (Plan §7 Q3 B): 데이터의 distinct 값(삭제 제외, "C" 순) + 빈 값이 있으면 맨 뒤에 PRICE_TYPE_NONE.
 * 빈 값 판정은 정렬·필터와 같은 isEmptyText.
 */
export async function listPriceTypes(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({
      priceType: sql<
        string | null
      >`case when ${isEmptyText(salesPrices.priceType)} then null else ${salesPrices.priceType} end`,
    })
    .from(salesPrices)
    .where(isNull(salesPrices.deletedAt));
  const values = rows.flatMap((row) => (row.priceType === null ? [] : [row.priceType]));
  // 코드포인트 순 (DB collation 무관)
  values.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return rows.some((row) => row.priceType === null) ? [...values, PRICE_TYPE_NONE] : values;
}

/** 연도 퀵칩 후보: 적용시작일에 등장하는 연도 (내림차순) */
export async function listEffectiveYears(db: Db): Promise<number[]> {
  const rows = await db
    .selectDistinct({ year: sql<number>`extract(year from ${salesPrices.effectiveFrom})::int` })
    .from(salesPrices)
    .where(isNull(salesPrices.deletedAt))
    .orderBy(desc(sql`1`));
  return rows.map((row) => Number(row.year));
}

export type PriceRowDetail = {
  row: SalesPrice & {
    itemStatus: ItemStatusLabel;
    major: string;
    batchFileName: string | null;
    /** ERP 품목대분류 원문 (예: D'Amo, PRAMI-003 §4.2.4) — 품목 마스터 있을 때 */
    erpMajor: string | null;
    /** ERP 비고 — **ADMIN 응답에만** (자유 텍스트에 사람 이름이 섞일 수 있음, §4.2.2) */
    erpRemark?: string | null;
  };
  history: Pick<
    SalesPrice,
    'id' | 'effectiveFrom' | 'effectiveTo' | 'unitPrice' | 'currency' | 'operationStatus' | 'source'
  >[];
};

/**
 * getPriceRowDetail (§4.7): 원본 20컬럼 + 메타 + 같은 계열 이력(삭제 제외).
 * `includeRemark` = ADMIN 일 때만 ERP 비고를 싣는다(USER 응답에는 키 자체가 없다, PRAMI-003 §4.2.2·AC-303).
 */
export async function getPriceRowDetail(
  db: Db,
  id: number,
  options: { includeRemark?: boolean } = {},
): Promise<PriceRowDetail | null> {
  const [row] = await db
    .select({
      price: salesPrices,
      itemStatus: ITEM_STATUS,
      major: MAJOR,
      batch: importBatches.fileName,
      erpMajor: items.categoryMajorRaw,
      remark: sql<string | null>`${items.raw}->>${ITEM_REMARK_HEADER}`,
    })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .leftJoin(importBatches, eq(importBatches.id, salesPrices.importBatchId))
    .where(and(eq(salesPrices.id, id), isNull(salesPrices.deletedAt)));
  if (!row) return null;
  const history = await db
    .select({
      id: salesPrices.id,
      effectiveFrom: salesPrices.effectiveFrom,
      effectiveTo: salesPrices.effectiveTo,
      unitPrice: salesPrices.unitPrice,
      currency: salesPrices.currency,
      operationStatus: salesPrices.operationStatus,
      source: salesPrices.source,
    })
    .from(salesPrices)
    .where(and(eq(salesPrices.seriesKey, row.price.seriesKey), isNull(salesPrices.deletedAt)))
    .orderBy(desc(salesPrices.effectiveFrom));
  return {
    row: {
      ...row.price,
      itemStatus: row.itemStatus,
      major: row.major,
      batchFileName: row.batch,
      erpMajor: row.erpMajor,
      ...(options.includeRemark ? { erpRemark: row.remark } : {}),
    },
    history,
  };
}

/**
 * 변동 이력 모달 요약 (price-change-history-modal §2.1-3·§6 A) — 클릭한 행 기준 계열 요소.
 * `erpRemark` = 품목 마스터 비고(계열 안 모든 행이 같은 값) — **ADMIN 응답에만**, 요약에 한 번(USER 응답에는 키 자체가 없다)
 */
export type PriceHistorySeries = {
  itemName: string;
  itemCode: string;
  priceType: string | null;
  priceCategory: string;
  currency: string;
  customerCode: string;
  customerName: string | null;
  erpRemark?: string | null;
};

export type PriceHistoryRow = {
  id: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  unitPrice: string;
  /** 같은 계열 직전 적용시작일 행 판매가 (가장 오래된 행 = null) */
  previousPrice: string | null;
  /** 현재 − 직전 (numeric 문자열, SQL 계산). 가장 오래된 행 = null */
  changeAmount: string | null;
  /** 표(#55)와 같은 변동률 식 — 소수 1자리 반올림. 첫 시기·직전가 0 = null */
  changeRate: number | null;
  operationStatus: '운영중' | '미사용';
  source: 'erp' | 'manual';
  /** ERP 임포트 배치 파일명 (수동 등록·배치 없음 = null) */
  batchFileName: string | null;
  /** 행별 판매단가 비고(sales_prices.remark) — 가격 표 '비고' 열과 같은 값, 모든 역할 (§6 A) */
  remark: string | null;
};

export type PriceHistory = {
  /** 요청한(클릭한) 행 id — 모달이 aria-current 로 강조한다 */
  currentId: number;
  series: PriceHistorySeries;
  /** 같은 계열의 삭제되지 않은 행 전부, 적용시작일 최신 순 */
  rows: PriceHistoryRow[];
};

/**
 * getPriceHistory (price-change-history-modal §2.1): 입력은 **가격 행 id 만** — series_key 는 서버가 id 로 찾는다.
 * ① id → series_key (삭제 행·없는 id → null = NOT_FOUND) ② 그 계열의 삭제 제외 행 + 계열 안 lag + 표와 같은 변동률식.
 * 원가 조인 없음. 변경자(created_by 등)는 싣지 않는다. `includeRemark`(ADMIN) 일 때만 요약에 품목 마스터 비고.
 */
export async function getPriceHistory(
  db: Db,
  priceRowId: number,
  options: { includeRemark?: boolean } = {},
): Promise<PriceHistory | null> {
  const [head] = await db
    .select({
      seriesKey: salesPrices.seriesKey,
      itemName: salesPrices.itemName,
      itemCode: salesPrices.itemCode,
      priceType: salesPrices.priceType,
      priceCategory: salesPrices.priceCategory,
      currency: salesPrices.currency,
      customerCode: salesPrices.customerCode,
      customerName: salesPrices.customerName,
      erpRemark: sql<string | null>`${items.raw}->>${ITEM_REMARK_HEADER}`,
    })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(and(eq(salesPrices.id, priceRowId), LIVE_PRICE));
  if (!head) return null;
  const { seriesKey, erpRemark, ...series } = head;
  const rows = await db
    .select({
      id: salesPrices.id,
      effectiveFrom: salesPrices.effectiveFrom,
      effectiveTo: salesPrices.effectiveTo,
      unitPrice: salesPrices.unitPrice,
      previousPrice: PREVIOUS_PRICE,
      changeAmount: PRICE_CHANGE_AMOUNT,
      changeRate: PRICE_CHANGE_RATE.mapWith(Number),
      operationStatus: salesPrices.operationStatus,
      source: salesPrices.source,
      batchFileName: importBatches.fileName,
      remark: salesPrices.remark,
    })
    .from(salesPrices)
    .innerJoin(previousPrices(seriesKey), PREVIOUS_PRICE_JOIN)
    .leftJoin(importBatches, eq(importBatches.id, salesPrices.importBatchId))
    .where(and(eq(salesPrices.seriesKey, seriesKey), LIVE_PRICE))
    .orderBy(desc(salesPrices.effectiveFrom), desc(salesPrices.id));
  return {
    currentId: priceRowId,
    series: options.includeRemark ? { ...series, erpRemark } : series,
    rows,
  };
}
