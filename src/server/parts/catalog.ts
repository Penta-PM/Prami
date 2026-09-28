import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { items, salesPrices } from '@/db/schema';

/**
 * 파츠 관리 후보 목록 (§4.5.6). 좌측 모델 = 본품, 우측 체크리스트 = 파츠.
 * 품목 마스터가 `item_kind` 를 주면 그대로 쓰고, 마스터 확정 전(stub)에는 `category_mid='Parts'` 또는
 * ERP 파츠 코드 규칙(품명 `N_xxxxx` / `N-xxxxx`, 예: `N_51080`)으로 파츠를 가른다 — 나머지는 본품.
 */
export type CatalogItem = {
  itemCode: string;
  itemName: string;
  productFamily: string;
  kind: '본품' | '파츠';
};

export type PartsCatalog = { models: CatalogItem[]; parts: CatalogItem[] };

/** 파츠 판정 SQL (마스터 우선, 없으면 품명 규칙) */
export const PART_KIND_SQL = sql<string>`case
  when ${items.itemKind} is not null then (case when ${items.itemKind} = '파츠' then '파츠' else '본품' end)
  when ${items.categoryMid} = 'Parts' then '파츠'
  when ${salesPrices.itemName} ~ '^N[_-][0-9]' then '파츠'
  else '본품' end`;

/** 판매단가에 등장하는 품번을 품번당 1건(최근 적용시작일)으로 */
async function listCatalog(db: Db, family: string): Promise<CatalogItem[]> {
  const rows = await db
    .selectDistinctOn([salesPrices.itemCode], {
      itemCode: salesPrices.itemCode,
      itemName: sql<string>`coalesce(${items.itemName}, ${salesPrices.itemName})`,
      productFamily: salesPrices.productFamily,
      kind: PART_KIND_SQL,
    })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(and(isNull(salesPrices.deletedAt), eq(salesPrices.productFamily, family)))
    .orderBy(salesPrices.itemCode, sql`${salesPrices.effectiveFrom} desc`);
  return rows
    .map((row) => ({ ...row, kind: row.kind === '파츠' ? ('파츠' as const) : ('본품' as const) }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName, 'ko'));
}

export async function listPartsCatalog(db: Db, family: string): Promise<PartsCatalog> {
  const all = await listCatalog(db, family);
  return {
    models: all.filter((item) => item.kind === '본품'),
    parts: all.filter((item) => item.kind === '파츠'),
  };
}

/** 제품군 탭 = 판매단가의 product_family (삭제 제외) */
export async function listProductFamilies(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ family: salesPrices.productFamily })
    .from(salesPrices)
    .where(isNull(salesPrices.deletedAt))
    .orderBy(asc(salesPrices.productFamily));
  return rows.map((row) => row.family);
}
