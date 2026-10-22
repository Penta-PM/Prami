import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';

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
import { toMoneyRange, type MoneyRange } from '@/lib/table/money-range';
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

/** 조회·관리 공통 행 (가격 변동 키 없음 — 조회 화면 /pricing 은 이 모양만 받는다, pricing-view-hide-price-change §2) */
export type PriceRowBase = {
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
};

/** 가격 변동 (cost-ratio-price-change §2.4) — `withPriceChange`(관리 화면 + pricing.write)일 때만 선택한다 */
export type PriceChangeFields = {
  /** 같은 계열(series_key)의 직전 적용시작일 행 판매가 (삭제 행 제외, 필터·페이지 무관). 첫 시기 = null */
  previousPrice: string | null;
  /** (현재 − 직전) / 직전 × 100, 소수 1자리 반올림(절댓값 기준 half-up). 첫 시기·직전가 0 = null */
  priceChangeRate: number | null;
};

/** 가격 표 행. 가격 변동 키는 `withPriceChange` 일 때만 있다(조회 화면 응답에는 키 자체가 없다) */
export type PriceRow = PriceRowBase & Partial<PriceChangeFields>;

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

const BASE_FIELDS = {
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
};

const CHANGE_FIELDS = {
  ...BASE_FIELDS,
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

const PRICE_FILTER_SPEC = buildFilterSpec(
  priceFilterDefs([], [], { withPriceChange: true }),
  PRICE_FILTER_SQL,
  {
    // 단가 유형 '— (없음)' = 빈 값(NULL·''·공백만·'—') — 표 칸 priceTypeLabel 의 '—' 와 같은 묶음
    emptyValues: { priceType: PRICE_TYPE_NONE },
  },
);

/**
 * 가격 변동 없는 화이트리스트 (조회 화면, pricing-view-hide-price-change §2) — `f.priceChange.*` 는 조건이 되지 않는다.
 * 파서(parsePriceFilter + priceFilterDefs(withPriceChange: false))가 이미 거르지만 쿼리에서도 한 번 더 막는다.
 */
const PRICE_FILTER_SPEC_NO_CHANGE = buildFilterSpec(
  priceFilterDefs([], [], { withPriceChange: false }),
  PRICE_FILTER_SQL,
  { emptyValues: { priceType: PRICE_TYPE_NONE } },
);

function buildWhere(filter: PriceFilter, withPriceChange: boolean): SQL | undefined {
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
  conditions.push(
    ...filterSqlConditions(
      filter.filters ?? [],
      withPriceChange ? PRICE_FILTER_SPEC : PRICE_FILTER_SPEC_NO_CHANGE,
    ),
  );
  return and(...conditions);
}

/** 가격 변동 열 필터가 있으면 count 도 직전가 윈도를 조인해야 한다 (가격 변동을 싣는 관리 화면만) */
function filtersByPriceChange(filter: PriceFilter, withPriceChange: boolean): boolean {
  return withPriceChange && (filter.filters ?? []).some((cond) => cond.col === 'priceChange');
}

/**
 * 가격 변동으로 정렬·필터하면 페이지를 고르기 전에 모든 행의 변동률이 필요하다 → 전체 윈도(현행).
 * 그 밖에는 페이지를 먼저 고르고 그 계열만 윈도를 돈다 (#55 성능, Plan §8 C/A)
 */
function needsFullWindow(filter: PriceFilter, withPriceChange: boolean): boolean {
  return (
    filtersByPriceChange(filter, withPriceChange) ||
    (withPriceChange && filter.sort?.id === 'priceChange')
  );
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

/**
 * 가격 변동 없는 정렬 맵 (조회 화면) — `sort=priceChange` 는 키를 더하지 않아 기본 정렬과 같다(직전가 윈도 조인 없음).
 * 파서(PRICE_VIEW_SORT_IDS)가 이미 거르지만 쿼리에서도 한 번 더 막는다.
 */
const PRICE_SORT_SQL_NO_CHANGE: Record<PriceSortId, (dir: SortDir) => SQL[]> = {
  ...PRICE_SORT_SQL,
  priceChange: () => [],
};

export type PriceRowsOptions = {
  /**
   * 가격 변동(직전가·변동률) 계산·선택 여부 (pricing-view-hide-price-change §1) — 관리 화면 + pricing.write 일 때만 true.
   * false(기본)면 직전가 윈도를 조인하지 않고, 행에 previousPrice·priceChangeRate 키가 없고, 가격 변동 필터·정렬은 무시한다.
   */
  withPriceChange?: boolean;
};

type Paging = Omit<PricePage, 'rows'> & { offset: number };

const offsetOf = (page: number) => (page - 1) * PRICE_PAGE_SIZE;

/** 건수 → 페이지 수·현재 페이지(범위 밖 = 마지막)·offset. 가격 변동 필터가 있을 때만 count 도 직전가 윈도를 조인한다 */
async function countPaging(
  db: Db,
  filter: PriceFilter,
  where: SQL | undefined,
  withPriceChange: boolean,
): Promise<Paging> {
  const countQuery = db
    .select({ total: count() })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .$dynamic();
  const [counted] = await (
    filtersByPriceChange(filter, withPriceChange)
      ? countQuery.leftJoin(ALL_PREVIOUS_PRICES, PREVIOUS_PRICE_JOIN)
      : countQuery
  ).where(where);
  const total = counted?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PRICE_PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  return { total, page, pageCount, offset: offsetOf(page) };
}

/** 전체 직전가 윈도를 id 로 조인해 고른 페이지 (가격 변동 정렬·필터 경로) */
function selectFullWindowPage(db: Db, filter: PriceFilter, where: SQL | undefined, offset: number) {
  return db
    .select(CHANGE_FIELDS)
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .leftJoin(ALL_PREVIOUS_PRICES, PREVIOUS_PRICE_JOIN)
    .where(where)
    .orderBy(...buildOrderBy(filter.sort, PRICE_SORT_SQL, DEFAULT_ORDER))
    .limit(PRICE_PAGE_SIZE)
    .offset(offset);
}

/** 2단계 ① — 윈도 없이 페이지 행(필터·정렬·limit/offset 은 전체 윈도 경로와 같다) + 계열 키 */
function selectPageWithSeries(db: Db, filter: PriceFilter, where: SQL | undefined, offset: number) {
  return db
    .select({ ...BASE_FIELDS, seriesKey: salesPrices.seriesKey })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(where)
    .orderBy(...buildOrderBy(filter.sort, PRICE_SORT_SQL, DEFAULT_ORDER))
    .limit(PRICE_PAGE_SIZE)
    .offset(offset);
}

/**
 * 2단계 (#55 성능, Plan §8 C/A): ① 윈도 없이 페이지 행 ② 그 행들의 계열만 윈도를 돌려 직전가·변동률을 id 로 붙인다.
 * lag 는 계열 안에서만 보므로 값은 전체 윈도와 같다(식은 공용 상수 그대로). count 는 윈도 없이 ①과 함께(동시에) 돈다 —
 * 요청 페이지가 범위 밖(마지막 페이지로 접힘)일 때만 ①을 다시 한다.
 */
async function getTwoStepPage(
  db: Db,
  filter: PriceFilter,
  where: SQL | undefined,
): Promise<PricePage> {
  const [{ offset, ...paging }, guessed] = await Promise.all([
    countPaging(db, filter, where, true),
    selectPageWithSeries(db, filter, where, offsetOf(filter.page)),
  ]);
  const pageRows =
    paging.page === filter.page ? guessed : await selectPageWithSeries(db, filter, where, offset);
  if (pageRows.length === 0) return { rows: [], ...paging };
  const changes = await db
    .select({
      id: salesPrices.id,
      previousPrice: PREVIOUS_PRICE,
      priceChangeRate: PRICE_CHANGE_RATE.mapWith(Number),
    })
    .from(salesPrices)
    .innerJoin(
      previousPrices([...new Set(pageRows.map((row) => row.seriesKey))]),
      PREVIOUS_PRICE_JOIN,
    )
    .where(
      inArray(
        salesPrices.id,
        pageRows.map((row) => row.id),
      ),
    );
  const byId = new Map(changes.map((change) => [change.id, change]));
  // series_key 는 응답 키가 아니다(조회·관리 행 모양 그대로)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 구조 분해로 키를 뺀다
  const rows = pageRows.map(({ seriesKey: _seriesKey, ...row }) => {
    const change = byId.get(row.id);
    return {
      ...row,
      previousPrice: change?.previousPrice ?? null,
      priceChangeRate: change?.priceChangeRate ?? null,
    };
  });
  return { rows, ...paging };
}

/**
 * getPriceRows (§4.7) — 원가 조인 없음. 가격 변동(직전가·변동률)은 `withPriceChange` 일 때만:
 * 가격 변동으로 정렬·필터하면 전체 기준 윈도를 id 로 조인, 아니면 현재 페이지 계열만 윈도(2단계, 같은 값)
 */
export async function getPriceRows(
  db: Db,
  filter: PriceFilter,
  options: PriceRowsOptions = {},
): Promise<PricePage> {
  const withPriceChange = options.withPriceChange === true;
  const where = buildWhere(filter, withPriceChange);
  if (withPriceChange && !needsFullWindow(filter, withPriceChange))
    return getTwoStepPage(db, filter, where);
  const { offset, ...paging } = await countPaging(db, filter, where, withPriceChange);
  const rows: PriceRow[] = withPriceChange
    ? await selectFullWindowPage(db, filter, where, offset)
    : await db
        .select(BASE_FIELDS)
        .from(salesPrices)
        .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
        .where(where)
        .orderBy(...buildOrderBy(filter.sort, PRICE_SORT_SQL_NO_CHANGE, DEFAULT_ORDER))
        .limit(PRICE_PAGE_SIZE)
        .offset(offset);
  return { rows, ...paging };
}

/**
 * 가격 변동을 싣는 표를 항상 전체 직전가 윈도로 고른다 (2단계 이전 getPriceRows 와 같은 쿼리).
 * 등가 테스트·벤치의 기준(oracle)으로만 쓴다
 */
export async function getPriceRowsFullWindow(db: Db, filter: PriceFilter): Promise<PricePage> {
  const where = buildWhere(filter, true);
  const { offset, ...paging } = await countPaging(db, filter, where, true);
  return { rows: await selectFullWindowPage(db, filter, where, offset), ...paging };
}

/**
 * 통화 열 필터 선택지 + 판매가 슬라이더 범위 (빠른 필터 바 §7.5): 데이터에 있는 통화 코드별 표 전체 최소·최대·0 초과 최소
 * (삭제 제외, 통화 오름차순). 다른 필터와 무관한 안정 범위 — 같은 스캔(group by 통화) 하나로 선택지와 범위를 함께 읽는다.
 */
export async function listPriceCurrencyRanges(db: Db): Promise<MoneyRange[]> {
  const rows = await db
    .select({
      currency: sql<string>`${salesPrices.currency}::text`,
      min: sql<string>`min(${salesPrices.unitPrice})::text`,
      max: sql<string>`max(${salesPrices.unitPrice})::text`,
      minPositive: sql<
        string | null
      >`(min(${salesPrices.unitPrice}) filter (where ${salesPrices.unitPrice} > 0))::text`,
    })
    .from(salesPrices)
    .where(isNull(salesPrices.deletedAt))
    .groupBy(salesPrices.currency)
    .orderBy(sql`1`);
  return rows.map(toMoneyRange);
}

/** 통화 열 필터 선택지만 (조회 상태 정규화 등) — listPriceCurrencyRanges 의 통화 코드 */
export async function listPriceCurrencies(db: Db): Promise<string[]> {
  return (await listPriceCurrencyRanges(db)).map((range) => range.currency);
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
  /**
   * 같은 계열 이력 — **관리 화면 + pricing.write 응답에만**(pricing-view-hide-price-change Q-V1 = B).
   * 조회 화면(/pricing)·USER 응답에는 키 자체가 없다(현재 행 정보만)
   */
  history?: Pick<
    SalesPrice,
    'id' | 'effectiveFrom' | 'effectiveTo' | 'unitPrice' | 'currency' | 'operationStatus' | 'source'
  >[];
};

/**
 * getPriceRowDetail (§4.7): 원본 20컬럼 + 메타 + 같은 계열 이력(삭제 제외).
 * `includeRemark` = ADMIN 일 때만 ERP 비고를 싣는다(USER 응답에는 키 자체가 없다, PRAMI-003 §4.2.2·AC-303).
 * `includeHistory` = 관리 화면 + pricing.write 일 때만 계열 이력을 싣는다(기본 false — 키 자체가 없고 이력 쿼리도 하지 않는다,
 * pricing-view-hide-price-change Q-V1 = B).
 */
export async function getPriceRowDetail(
  db: Db,
  id: number,
  options: { includeRemark?: boolean; includeHistory?: boolean } = {},
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
  const detailRow = {
    ...row.price,
    itemStatus: row.itemStatus,
    major: row.major,
    batchFileName: row.batch,
    erpMajor: row.erpMajor,
    ...(options.includeRemark ? { erpRemark: row.remark } : {}),
  };
  if (!options.includeHistory) return { row: detailRow };
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
  return { row: detailRow, history };
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
