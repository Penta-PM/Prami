import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { ITEM_REMARK_HEADER } from '@/server/imports/schemas/items';
import { importBatches, items, salesPrices, type SalesPrice } from '@/db/schema';
import type { PriceFilter } from '@/features/pricing/filter';
import { productFamilyMajors } from '@/lib/constants/product-cards';
import { ITEM_STATUS_UNKNOWN } from '@/lib/constants/item-status';

import { dateConditions } from './date-filter';

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

/** 날짜 필터 SQL (§4.5.2) — 원가와 공용 규칙 */
export function dateCondition(filter: Pick<PriceFilter, 'dateMode' | 'from' | 'to'>): SQL[] {
  return dateConditions(salesPrices, filter);
}

function buildWhere(filter: PriceFilter): SQL | undefined {
  const conditions: SQL[] = [isNull(salesPrices.deletedAt) as SQL, ...dateCondition(filter)];
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
