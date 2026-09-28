import { and, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { salesPrices } from '@/db/schema';

/**
 * 챗봇이 읽는 판매단가 (§4.5.9): `sales_prices` 만 본다. 원가(material_costs)는 import 조차 하지 않는다 (AC-43·81).
 * 검색은 통합 검색(§4.5.4)과 같은 규칙 — ILIKE 와일드카드 이스케이프, 품명 NBSP 정규화.
 */
export type ChatItemHit = {
  itemCode: string;
  itemName: string;
  productFamily: string;
};

export type ChatPrice = {
  itemCode: string;
  itemName: string;
  productFamily: string;
  priceType: string | null;
  unitPrice: string;
  currency: string;
  effectiveFrom: string;
};

export const CHAT_CANDIDATE_LIMIT = 6;
export const NORMAL_PRICE_TYPE = '정상판매';

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const nameSql = sql`replace(${salesPrices.itemName}, chr(160), ' ')`;

/** 품명·품번 부분 일치 후보 (품번당 1건, 정확히 일치하는 품명·품번을 앞에). 제품군이 주어지면 그 안에서만 */
export async function findChatItems(
  db: Db,
  term: string,
  family: string | null = null,
  limit: number = CHAT_CANDIDATE_LIMIT,
): Promise<ChatItemHit[]> {
  const like = likePattern(term);
  const conditions = [
    isNull(salesPrices.deletedAt),
    or(sql`${nameSql} ilike ${like}`, ilike(salesPrices.itemCode, like)),
  ];
  if (family) conditions.push(eq(salesPrices.productFamily, family));
  const rows = await db
    .selectDistinctOn([salesPrices.itemCode], {
      itemCode: salesPrices.itemCode,
      itemName: salesPrices.itemName,
      productFamily: salesPrices.productFamily,
    })
    .from(salesPrices)
    .where(and(...conditions))
    .orderBy(salesPrices.itemCode, desc(salesPrices.effectiveFrom), desc(salesPrices.id))
    .limit(limit + 1);
  const lower = term.toLowerCase();
  const rank = (hit: ChatItemHit) =>
    hit.itemCode.toLowerCase() === lower || hit.itemName.trim().toLowerCase() === lower
      ? 0
      : hit.itemName.toLowerCase().startsWith(lower)
        ? 1
        : 2;
  return rows
    .sort((a, b) => rank(a) - rank(b) || a.itemName.localeCompare(b.itemName, 'ko'))
    .slice(0, limit);
}

/** 여러 후보 문자열(별칭 포함)을 차례로 검색해 처음 결과가 있는 것을 돌려준다 */
export async function findChatItemsByTerms(
  db: Db,
  terms: readonly string[],
  family: string | null = null,
): Promise<ChatItemHit[]> {
  for (const term of terms) {
    const hits = await findChatItems(db, term, family);
    if (hits.length > 0) return hits;
  }
  return [];
}

function priceSelection() {
  return {
    itemCode: salesPrices.itemCode,
    itemName: salesPrices.itemName,
    productFamily: salesPrices.productFamily,
    priceType: salesPrices.priceType,
    unitPrice: salesPrices.unitPrice,
    currency: salesPrices.currency,
    effectiveFrom: salesPrices.effectiveFrom,
  };
}

/** 최신 운영중 가격: 정상판매 우선, 없으면 운영중 어떤 단가유형이든 최신 행 */
export async function latestChatPrice(db: Db, itemCode: string): Promise<ChatPrice | null> {
  const base = [
    isNull(salesPrices.deletedAt),
    eq(salesPrices.itemCode, itemCode),
    eq(salesPrices.operationStatus, '운영중'),
  ];
  const [normal] = await db
    .select(priceSelection())
    .from(salesPrices)
    .where(and(...base, eq(salesPrices.priceType, NORMAL_PRICE_TYPE)))
    .orderBy(desc(salesPrices.effectiveFrom), desc(salesPrices.id))
    .limit(1);
  if (normal) return normal;
  const [any] = await db
    .select(priceSelection())
    .from(salesPrices)
    .where(and(...base))
    .orderBy(desc(salesPrices.effectiveFrom), desc(salesPrices.id))
    .limit(1);
  return any ?? null;
}

/** 연도 비교용: 같은 품번·단가유형에서 현재 행보다 앞선 적용시작일의 최신 행 (상태 무관, 삭제 제외) */
export async function previousChatPrice(db: Db, current: ChatPrice): Promise<ChatPrice | null> {
  const [row] = await db
    .select(priceSelection())
    .from(salesPrices)
    .where(
      and(
        isNull(salesPrices.deletedAt),
        eq(salesPrices.itemCode, current.itemCode),
        current.priceType
          ? eq(salesPrices.priceType, current.priceType)
          : isNull(salesPrices.priceType),
        lt(salesPrices.effectiveFrom, current.effectiveFrom),
      ),
    )
    .orderBy(desc(salesPrices.effectiveFrom), desc(salesPrices.id))
    .limit(1);
  return row ?? null;
}

/** 제품군의 운영중 품번 수 (제품군 칩 응답용) */
export async function countFamilyItems(db: Db, family: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${salesPrices.itemCode})::int` })
    .from(salesPrices)
    .where(
      and(
        isNull(salesPrices.deletedAt),
        eq(salesPrices.productFamily, family),
        eq(salesPrices.operationStatus, '운영중'),
      ),
    );
  return row?.count ?? 0;
}
