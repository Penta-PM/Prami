import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { items, salesPrices } from '@/db/schema';
import { STUB_ITEM_KIND } from '@/lib/constants/item-kind-rules';
import { PRODUCT_CARDS } from '@/lib/constants/product-cards';

/**
 * 파츠 관리 후보 목록 (§4.5.6). 좌측 모델 = 본품, 우측 체크리스트 = 파츠.
 * 종류는 품목 마스터 적용 시 저장된 `items.item_kind`(규칙표 K0~K7, PRAMI-003 §4.2.7)만 읽는다 — 품명으로 판정하지 않는다.
 */
export type ItemKind = '본품' | '파츠' | '결합형' | '서비스' | '기타';

export type CatalogItem = {
  itemCode: string;
  itemName: string;
  productFamily: string;
  kind: ItemKind;
};

export type PartsCatalog = { models: CatalogItem[]; parts: CatalogItem[] };

/**
 * 품목 종류 SQL = 저장된 `items.item_kind`. 마스터에 없는(stub) 품번은 `기타`(STEP3 품목) — 파츠·결합형으로 오인하지 않는다
 * (PRAMI-003 §4.2.7, AC-313). 견적 계산기(STEP3~5)도 같은 값을 쓴다.
 */
export const ITEM_KIND_SQL = sql<string>`coalesce(${items.itemKind}::text, ${STUB_ITEM_KIND})`;

const KINDS: readonly ItemKind[] = ['본품', '파츠', '결합형', '서비스', '기타'];

export function asItemKind(value: string): ItemKind {
  return (KINDS as readonly string[]).includes(value) ? (value as ItemKind) : '기타';
}

/** 판매단가에 등장하는 품번을 품번당 1건(최근 적용시작일)으로 */
async function listCatalog(db: Db, family: string): Promise<CatalogItem[]> {
  const rows = await db
    .selectDistinctOn([salesPrices.itemCode], {
      itemCode: salesPrices.itemCode,
      itemName: sql<string>`coalesce(${items.itemName}, ${salesPrices.itemName})`,
      productFamily: salesPrices.productFamily,
      kind: ITEM_KIND_SQL,
    })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(and(isNull(salesPrices.deletedAt), eq(salesPrices.productFamily, family)))
    .orderBy(salesPrices.itemCode, sql`${salesPrices.effectiveFrom} desc`);
  return rows
    .map((row) => ({ ...row, kind: asItemKind(row.kind) }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName, 'ko'));
}

/** 모델 = 본품(서비스·결합형 제외), 파츠 = 파츠 */
export async function listPartsCatalog(db: Db, family: string): Promise<PartsCatalog> {
  const all = await listCatalog(db, family);
  return {
    models: all.filter((item) => item.kind === '본품'),
    parts: all.filter((item) => item.kind === '파츠'),
  };
}

/** 제품군 탭 순서 = 홈 카드 순서(WAPPLES, D.AMO, iSIGN, Cloudbric), `iSIGN PKI` 는 iSIGN 다음, 나머지는 이름순 */
export function sortFamilies(families: readonly string[]): string[] {
  const rank = new Map<string, number>();
  PRODUCT_CARDS.forEach((card, index) => {
    const majors = card.majors ?? [card.major];
    majors.forEach((major, offset) => rank.set(major, index * 10 + offset));
  });
  return [...families].sort((a, b) => {
    const ra = rank.get(a) ?? 1000;
    const rb = rank.get(b) ?? 1000;
    return ra === rb ? a.localeCompare(b) : ra - rb;
  });
}

/** 제품군 탭 = 판매단가의 product_family (삭제 제외) */
export async function listProductFamilies(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ family: salesPrices.productFamily })
    .from(salesPrices)
    .where(isNull(salesPrices.deletedAt))
    .orderBy(asc(salesPrices.productFamily));
  return sortFamilies(rows.map((row) => row.family));
}
