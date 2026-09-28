import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { importBatches, items, salesPrices, type SalesPrice } from '@/db/schema';
import type { PriceFilter } from '@/features/pricing/filter';
import { ITEM_STATUS_UNKNOWN } from '@/lib/constants/item-status';

/** 조회·관리 표 (§4.5.3) — 서버 페이지네이션 50행, 정렬 effective_from DESC, item_name */
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

/** 날짜 필터 SQL (§4.5.2). 적용시작일 기준 = 시작일 범위, 적용기간 기준 = 구간 겹침(배타적 종료일) */
export function dateCondition(filter: Pick<PriceFilter, 'dateMode' | 'from' | 'to'>): SQL[] {
  const conditions: SQL[] = [];
  const { from, to } = filter;
  if (filter.dateMode === 'start') {
    if (from) conditions.push(sql`${salesPrices.effectiveFrom} >= ${from}`);
    if (to) conditions.push(sql`${salesPrices.effectiveFrom} <= ${to}`);
    return conditions;
  }
  if (to) conditions.push(sql`${salesPrices.effectiveFrom} <= ${to}`);
  if (from) {
    conditions.push(
      sql`(${salesPrices.effectiveTo} is null or ${salesPrices.effectiveTo} > ${from})`,
    );
  }
  return conditions;
}

function buildWhere(filter: PriceFilter): SQL | undefined {
  const conditions: SQL[] = [isNull(salesPrices.deletedAt) as SQL, ...dateCondition(filter)];
  if (filter.major) conditions.push(sql`${MAJOR} = ${filter.major}`);
  if (filter.mid) conditions.push(eq(items.categoryMid, filter.mid) as SQL);
  if (filter.minor) conditions.push(eq(items.categoryMinor, filter.minor) as SQL);
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q)}%`;
    // 품명 NBSP 는 검색 시에만 공백으로 정규화 (§4.3.1, R-10)
    conditions.push(
      sql`(replace(${salesPrices.itemName}, chr(160), ' ') ilike ${pattern} or ${salesPrices.itemCode} ilike ${pattern})`,
    );
  }
  return and(...conditions);
}

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
};

/** getPriceRows (§4.7) — 원가 조인 없음 */
export async function getPriceRows(db: Db, filter: PriceFilter): Promise<PricePage> {
  const where = buildWhere(filter);
  const [counted] = await db
    .select({ total: count() })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(where);
  const total = counted?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PRICE_PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  const rows = await db
    .select(ROW_FIELDS)
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(where)
    .orderBy(desc(salesPrices.effectiveFrom), asc(salesPrices.itemName), asc(salesPrices.id))
    .limit(PRICE_PAGE_SIZE)
    .offset((page - 1) * PRICE_PAGE_SIZE);
  return { rows, total, page, pageCount };
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
  row: SalesPrice & { itemStatus: ItemStatusLabel; major: string; batchFileName: string | null };
  history: Pick<
    SalesPrice,
    'id' | 'effectiveFrom' | 'effectiveTo' | 'unitPrice' | 'currency' | 'operationStatus' | 'source'
  >[];
};

/** getPriceRowDetail (§4.7): 원본 20컬럼 + 메타 + 같은 계열 이력(삭제 제외) */
export async function getPriceRowDetail(db: Db, id: number): Promise<PriceRowDetail | null> {
  const [row] = await db
    .select({
      price: salesPrices,
      itemStatus: ITEM_STATUS,
      major: MAJOR,
      batch: importBatches.fileName,
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
    row: { ...row.price, itemStatus: row.itemStatus, major: row.major, batchFileName: row.batch },
    history,
  };
}
