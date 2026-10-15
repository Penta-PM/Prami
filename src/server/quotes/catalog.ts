import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { Db } from '@/db';
import { items, partMappings, salesPrices } from '@/db/schema';
import { asItemKind, ITEM_KIND_SQL, type ItemKind } from '@/server/parts/catalog';

/**
 * 견적 계산기 후보 조회 (§4.5.7 STEP1~5). 모두 `sales_prices` 의 운영중 행만 보고, 단가유형은 DB DISTINCT 값이다
 * (디자인의 배수 `mult` 는 쓰지 않는다, AC-61). 원가는 어디에서도 조인하지 않는다 (AC-43).
 */
export type PriceTypeOption = { priceType: string; count: number };

export type CategoryChips = {
  /** 품목 마스터가 있으면 대분류 = items.category_major, 없으면 제품군 하나 */
  majors: string[];
  mids: string[];
  /** 중분류 → 그 중분류의 소분류(정렬, 빈 값 제외). 클라이언트가 선택한 중분류로 바로 파생한다 */
  minorsByMid: Record<string, string[]>;
  hasMaster: boolean;
};

export type QuoteItem = {
  itemCode: string;
  itemName: string;
  unitPrice: string;
  currency: string;
  priceType: string;
  kind: ItemKind;
};

export type QuoteItemFilter = {
  family: string;
  priceType: string;
  mid?: string;
  minor?: string;
};

/** STEP1: 선택 제품군의 운영중 행에 실제로 있는 단가유형 (많은 순) */
export async function listQuotePriceTypes(db: Db, family: string): Promise<PriceTypeOption[]> {
  const rows = await db
    .select({ priceType: salesPrices.priceType, count: sql<number>`count(*)::int` })
    .from(salesPrices)
    .where(
      and(
        isNull(salesPrices.deletedAt),
        eq(salesPrices.operationStatus, '운영중'),
        eq(salesPrices.productFamily, family),
        sql`${salesPrices.priceType} is not null`,
      ),
    )
    .groupBy(salesPrices.priceType)
    .orderBy(desc(sql`count(*)`), asc(salesPrices.priceType));
  return rows.flatMap((row) =>
    row.priceType ? [{ priceType: row.priceType, count: row.count }] : [],
  );
}

/**
 * STEP2: 대/중/소 칩. 마스터가 없으면 대분류 = 제품군 하나, 중/소는 비어 있다 (§4.5.1 fallback 과 동일).
 * 소분류는 중분류별로 한 번에 미리 내려준다(DISTINCT mid·minor 1회) — 중분류 선택 시 재조회가 없다.
 */
export async function listQuoteCategories(db: Db, family: string): Promise<CategoryChips> {
  const scope = and(isNull(salesPrices.deletedAt), eq(salesPrices.productFamily, family));
  const distinct = async (column: AnyPgColumn) =>
    (
      await db
        .selectDistinct({ value: column })
        .from(items)
        .innerJoin(salesPrices, eq(salesPrices.itemCode, items.itemCode))
        .where(and(scope, sql`${column} is not null`))
        .orderBy(asc(column))
    ).map((row) => row.value as string);
  const majors = await distinct(items.categoryMajor);
  if (majors.length === 0) return { majors: [family], mids: [], minorsByMid: {}, hasMaster: false };
  const mids = await distinct(items.categoryMid);
  const pairs = await db
    .selectDistinct({ mid: items.categoryMid, minor: items.categoryMinor })
    .from(items)
    .innerJoin(salesPrices, eq(salesPrices.itemCode, items.itemCode))
    .where(
      and(
        scope,
        sql`${items.categoryMid} is not null`,
        sql`nullif(btrim(${items.categoryMinor}), '') is not null`,
      ),
    )
    .orderBy(asc(items.categoryMid), asc(items.categoryMinor));
  // Map → fromEntries: 중분류 값이 '__proto__' 같은 이름이어도 own 속성으로 담긴다 (DB 정렬 순서 유지)
  const grouped = new Map<string, string[]>();
  for (const { mid, minor } of pairs) {
    if (mid === null || minor === null) continue;
    grouped.set(mid, [...(grouped.get(mid) ?? []), minor]);
  }
  return { majors, mids, minorsByMid: Object.fromEntries(grouped), hasMaster: true };
}

/** 선택 단가유형의 운영중 최신 행 (품번당 1건) */
async function latestRows(db: Db, filter: QuoteItemFilter): Promise<QuoteItem[]> {
  const conditions = [
    isNull(salesPrices.deletedAt),
    eq(salesPrices.operationStatus, '운영중'),
    eq(salesPrices.productFamily, filter.family),
    eq(salesPrices.priceType, filter.priceType),
  ];
  if (filter.mid) conditions.push(eq(items.categoryMid, filter.mid));
  if (filter.minor) conditions.push(eq(items.categoryMinor, filter.minor));
  const rows = await db
    .selectDistinctOn([salesPrices.itemCode], {
      itemCode: salesPrices.itemCode,
      itemName: sql<string>`coalesce(${items.itemName}, ${salesPrices.itemName})`,
      unitPrice: salesPrices.unitPrice,
      currency: salesPrices.currency,
      priceType: sql<string>`${salesPrices.priceType}`,
      kind: ITEM_KIND_SQL,
    })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(and(...conditions))
    .orderBy(salesPrices.itemCode, desc(salesPrices.effectiveFrom), desc(salesPrices.id));
  return rows
    .map((row) => ({ ...row, kind: asItemKind(row.kind) }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName, 'ko'));
}

/** STEP3: 품목 = 파츠·결합형이 아닌 것(본품·서비스·기타), 선택 단가유형의 최신 행 가격 (AC-61) */
export async function listQuoteItems(db: Db, filter: QuoteItemFilter): Promise<QuoteItem[]> {
  const rows = await latestRows(db, filter);
  return rows.filter((row) => row.kind !== '파츠' && row.kind !== '결합형');
}

/**
 * STEP4: 선택 모델의 `part_mappings` 가 있으면 그 파츠만(AC-62), 없으면 같은 제품군 파츠 전체(디자인 fallback).
 * 파츠 가격은 선택 단가유형의 최신 행, 없으면 정상판매 최신 행. 둘 다 없으면 제외.
 */
export async function listQuoteParts(
  db: Db,
  filter: QuoteItemFilter & { modelItemCode: string },
): Promise<{ parts: QuoteItem[]; mapped: boolean }> {
  const mapping = await db
    .select({ code: partMappings.partItemCode })
    .from(partMappings)
    .where(eq(partMappings.modelItemCode, filter.modelItemCode))
    .orderBy(asc(partMappings.sortOrder), asc(partMappings.id));
  const mappedCodes = mapping.map((row) => row.code);
  const priced = await pricedParts(db, filter, mappedCodes.length > 0 ? mappedCodes : null);
  if (mappedCodes.length === 0) return { parts: priced, mapped: false };
  const order = new Map(mappedCodes.map((code, index) => [code, index]));
  return {
    parts: priced.sort((a, b) => (order.get(a.itemCode) ?? 0) - (order.get(b.itemCode) ?? 0)),
    mapped: true,
  };
}

async function pricedParts(
  db: Db,
  filter: QuoteItemFilter,
  codes: readonly string[] | null,
): Promise<QuoteItem[]> {
  const base = { family: filter.family, priceType: filter.priceType };
  const bySelected = await latestRows(db, base);
  const byNormal =
    filter.priceType === '정상판매'
      ? bySelected
      : await latestRows(db, { ...base, priceType: '정상판매' });
  const pick = (rows: QuoteItem[]) =>
    rows.filter((row) => (codes ? codes.includes(row.itemCode) : row.kind === '파츠'));
  const selected = pick(bySelected);
  const seen = new Set(selected.map((row) => row.itemCode));
  const fallback = pick(byNormal).filter((row) => !seen.has(row.itemCode));
  return [...selected, ...fallback];
}

/** STEP5: 같은 제품군의 결합형 (마스터 `item_kind='결합형'`). 마스터 없으면 빈 목록 */
export async function listQuoteBundles(db: Db, filter: QuoteItemFilter): Promise<QuoteItem[]> {
  const rows = await latestRows(db, { family: filter.family, priceType: filter.priceType });
  return rows.filter((row) => row.kind === '결합형');
}

/** 그룹 솔루션의 하드웨어 후보 = 같은 제품군 본품(정상판매 최신 행) */
export async function listGroupHardware(db: Db, family: string): Promise<QuoteItem[]> {
  const rows = await latestRows(db, { family, priceType: '정상판매' });
  return rows.filter((row) => row.kind === '본품');
}

/** 담기(라인 복원) 시 품번 존재 확인용 */
export async function listItemNames(
  db: Db,
  codes: readonly string[],
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const rows = await db
    .select({ code: items.itemCode, name: items.itemName })
    .from(items)
    .where(inArray(items.itemCode, [...codes]));
  return new Map(rows.map((row) => [row.code, row.name]));
}
