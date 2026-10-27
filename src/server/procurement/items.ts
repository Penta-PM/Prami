import 'server-only';

import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { Db } from '@/db';
import { procurementItems, procurementVItemPrices } from '@/db/schema/procurement';
import type { SortDir } from '@/lib/table/compare';
import { toMoneyRange, type MoneyRange } from '@/lib/table/money-range';
import type { SortState } from '@/lib/table/sort-param';
import { buildOrderBy, byText, byValue } from '@/server/pricing/sort-sql';

import { assertProcurementAccess, type ProcurementAccess } from './access-token';
import { countRows, escapeLike, pageSizeOf, pageWindow, type Paged } from './shared';

/**
 * 등록 품목 (UI-2). 대상 = items.status 'active'(등록). 계약단가 = v_item_prices(0 초과 최근 단가, 원).
 * 정렬·필터·페이지네이션은 전부 SQL — 브라우저에 전량을 내리지 않는다.
 */

export const PROCUREMENT_ITEM_SORT_IDS = [
  'registeredOn',
  'product',
  'detailCategory',
  'manufacturer',
  'itemId',
  'itemName',
  'unitPrice',
] as const;
export type ProcurementItemSortId = (typeof PROCUREMENT_ITEM_SORT_IDS)[number];

export type ProcurementItemFilter = {
  /** 제품 (복수 선택, 비우면 전체) */
  products?: readonly string[];
  /** 세부분류 detail_category (복수 선택) */
  detailCategories?: readonly string[];
  manufacturers?: readonly string[];
  /** 물품식별번호·품목명 부분 일치 */
  q?: string;
  /** 등록일자 'YYYY-MM-DD' (양 끝 포함) */
  registeredFrom?: string;
  registeredTo?: string;
  /** 계약단가 범위 (원, 양 끝 포함). 하나라도 있으면 단가 없는 물품은 빠진다 */
  priceMin?: number | null;
  priceMax?: number | null;
  sort?: SortState<ProcurementItemSortId>;
  page?: number;
  pageSize?: number;
};

export type ProcurementItemRow = {
  id: number;
  itemId: string;
  product: string;
  productGroup: string | null;
  detailCategory: string | null;
  manufacturer: string | null;
  itemName: string | null;
  registeredOn: string | null;
  source: string;
  /** 계약단가 (원) — 납품 이력이 없으면 null */
  unitPrice: number | null;
  priceDate: string | null;
};

const t = procurementItems;
const p = procurementVItemPrices;

const ITEM_SORT_SQL: Record<ProcurementItemSortId, (dir: SortDir) => SQL[]> = {
  registeredOn: (dir) => [byValue(t.registeredOn, dir)],
  product: (dir) => byText(t.product, dir),
  detailCategory: (dir) => byText(t.detailCategory, dir),
  manufacturer: (dir) => byText(t.manufacturer, dir),
  itemId: (dir) => byText(t.itemId, dir),
  itemName: (dir) => byText(t.itemName, dir),
  unitPrice: (dir) => [byValue(p.unitPrice, dir)],
};

/** 기본: 등록일자 최신순 → 물품식별번호 → id (stable) */
const DEFAULT_ORDER: SQL[] = [sql`${t.registeredOn} desc nulls last`, asc(t.itemId), asc(t.id)];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildWhere(filter: ProcurementItemFilter): SQL | undefined {
  const conditions: SQL[] = [eq(t.status, 'active') as SQL];
  if (filter.products?.length) conditions.push(inArray(t.product, [...filter.products]) as SQL);
  if (filter.detailCategories?.length)
    conditions.push(inArray(t.detailCategory, [...filter.detailCategories]) as SQL);
  if (filter.manufacturers?.length)
    conditions.push(inArray(t.manufacturer, [...filter.manufacturers]) as SQL);
  const q = filter.q?.trim();
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(sql`(${t.itemId} ilike ${pattern} or ${t.itemName} ilike ${pattern})`);
  }
  for (const [value, op] of [
    [filter.registeredFrom, sql.raw('>=')],
    [filter.registeredTo, sql.raw('<=')],
  ] as const) {
    if (!value) continue;
    if (!DATE_RE.test(value)) throw new RangeError(`날짜 형식이 아닙니다 (YYYY-MM-DD): ${value}`);
    conditions.push(sql`${t.registeredOn} ${op} ${value}::date`);
  }
  if (typeof filter.priceMin === 'number')
    conditions.push(sql`${p.unitPrice} >= ${filter.priceMin}`);
  if (typeof filter.priceMax === 'number')
    conditions.push(sql`${p.unitPrice} <= ${filter.priceMax}`);
  return and(...conditions);
}

const ROW_SELECTION = {
  id: t.id,
  itemId: t.itemId,
  product: t.product,
  productGroup: t.productGroup,
  detailCategory: t.detailCategory,
  manufacturer: t.manufacturer,
  itemName: t.itemName,
  registeredOn: t.registeredOn,
  source: t.source,
  unitPrice: p.unitPrice,
  priceDate: p.priceDate,
};

/** 등록 품목 표 한 페이지 (기본 50행) */
export async function getProcurementItemRows(
  access: ProcurementAccess,
  db: Db,
  filter: ProcurementItemFilter = {},
): Promise<Paged<ProcurementItemRow>> {
  assertProcurementAccess(access, 'read');
  const pageSize = pageSizeOf(filter.pageSize);
  const where = buildWhere(filter);
  const [counted] = await db
    .select({ total: countRows() })
    .from(t)
    .leftJoin(p, eq(p.itemId, t.itemId))
    .where(where);
  const total = counted?.total ?? 0;
  const { page, pageCount, offset } = pageWindow(total, filter.page ?? 1, pageSize);
  const rows = await db
    .select(ROW_SELECTION)
    .from(t)
    .leftJoin(p, eq(p.itemId, t.itemId))
    .where(where)
    .orderBy(...buildOrderBy(filter.sort, ITEM_SORT_SQL, DEFAULT_ORDER))
    .limit(pageSize)
    .offset(offset);
  return { rows, total, page, pageCount, pageSize };
}

/** xlsx 다운로드 상한 — 넘으면 truncated (등록 품목은 수백 건 규모) */
export const PROCUREMENT_ITEM_EXPORT_LIMIT = 10_000;

/** 현재 필터·정렬 결과 전체 (xlsx 다운로드, 페이지 무시) */
export async function getProcurementItemRowsForExport(
  access: ProcurementAccess,
  db: Db,
  filter: Omit<ProcurementItemFilter, 'page' | 'pageSize'> = {},
): Promise<{ rows: ProcurementItemRow[]; truncated: boolean }> {
  assertProcurementAccess(access, 'read');
  const rows = await db
    .select(ROW_SELECTION)
    .from(t)
    .leftJoin(p, eq(p.itemId, t.itemId))
    .where(buildWhere(filter))
    .orderBy(...buildOrderBy(filter.sort, ITEM_SORT_SQL, DEFAULT_ORDER))
    .limit(PROCUREMENT_ITEM_EXPORT_LIMIT + 1);
  const truncated = rows.length > PROCUREMENT_ITEM_EXPORT_LIMIT;
  return { rows: truncated ? rows.slice(0, PROCUREMENT_ITEM_EXPORT_LIMIT) : rows, truncated };
}

export type FacetOption = { value: string; count: number };

export type ProcurementItemFacets = {
  products: FacetOption[];
  detailCategories: FacetOption[];
  manufacturers: FacetOption[];
};

/** 빠른 필터 바 고정 필드(제품·세부분류·제조사) 선택지 + 건수 — 등록(active) 전체 기준, 값 오름차순(빈 값 제외) */
export async function getProcurementItemFacets(
  access: ProcurementAccess,
  db: Db,
): Promise<ProcurementItemFacets> {
  assertProcurementAccess(access, 'read');
  const facet = async (column: AnyPgColumn) => {
    const rows = await db
      .select({ value: sql<string>`${column}`, count: countRows() })
      .from(t)
      .where(and(eq(t.status, 'active'), sql`coalesce(btrim(${column}), '') <> ''`))
      .groupBy(column)
      .orderBy(asc(column));
    return rows;
  };
  const [products, detailCategories, manufacturers] = await Promise.all([
    facet(t.product),
    facet(t.detailCategory),
    facet(t.manufacturer),
  ]);
  return { products, detailCategories, manufacturers };
}

/**
 * 계약단가 슬라이더 범위 (빠른 필터 바 §7.5 와 같은 MoneyRange, 통화 KRW): 등록 물품 전체의 최소·최대·0 초과 최소.
 * 다른 필터와 무관. 단가가 하나도 없으면 undefined.
 */
export async function getProcurementItemPriceRange(
  access: ProcurementAccess,
  db: Db,
): Promise<MoneyRange | undefined> {
  assertProcurementAccess(access, 'read');
  const [row] = await db
    .select({
      n: countRows(),
      min: sql<string>`min(${p.unitPrice})::text`,
      max: sql<string>`max(${p.unitPrice})::text`,
      minPositive: sql<
        string | null
      >`(min(${p.unitPrice}) filter (where ${p.unitPrice} > 0))::text`,
    })
    .from(t)
    .innerJoin(p, eq(p.itemId, t.itemId))
    .where(eq(t.status, 'active'));
  if (!row || row.n === 0) return undefined;
  return toMoneyRange({ currency: 'KRW', ...row });
}
