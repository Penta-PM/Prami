import { and, desc, eq, ilike, isNull, lt, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { salesPrices } from '@/db/schema';

import { anchorToken, matchByTokens } from './match';

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

export const NORMAL_PRICE_TYPE = '정상판매';
/** SQL 1차 거르기 상한 (토큰 규칙은 JS 에서) */
const PREFILTER_LIMIT = 500;

/** ILIKE 와일드카드(\ % _)를 문자 그대로 (검색 §4.5.4 와 같은 규칙) */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function likePattern(term: string): string {
  return `%${escapeLike(term)}%`;
}

const nameSql = sql`replace(${salesPrices.itemName}, chr(160), ' ')`;

/** 운영중·삭제되지 않은 행 (§4.5.9 r6: 후보는 최신 운영중 행만 센다) */
function liveConditions(family: string | null) {
  const conditions = [isNull(salesPrices.deletedAt), eq(salesPrices.operationStatus, '운영중')];
  if (family) conditions.push(eq(salesPrices.productFamily, family));
  return conditions;
}

const hitSelection = {
  itemCode: salesPrices.itemCode,
  itemName: salesPrices.itemName,
  productFamily: salesPrices.productFamily,
};

export type ChatItemSearch = { hits: ChatItemHit[]; exactCode: boolean };

/**
 * 품명·품번 후보 (§4.5.9 r6, AC-80): 품번 정확 일치가 있으면 그 1건, 아니면 가장 긴 검색어 토큰으로 ILIKE 1차 거르기 후
 * 토큰 단위 규칙(match.ts)으로 좁힌다. 품번당 1건(최신 적용시작일 운영중 행), 품명순.
 */
export async function findChatItems(
  db: Db,
  term: string,
  family: string | null = null,
): Promise<ChatItemSearch> {
  const exact = await db
    .selectDistinctOn([salesPrices.itemCode], hitSelection)
    .from(salesPrices)
    .where(and(...liveConditions(family), ilike(salesPrices.itemCode, escapeLike(term))))
    .orderBy(salesPrices.itemCode, desc(salesPrices.effectiveFrom), desc(salesPrices.id))
    .limit(1);
  if (exact.length > 0) return { hits: exact, exactCode: true };
  const anchor = anchorToken(term);
  if (!anchor) return { hits: [], exactCode: false };
  const rows = await db
    .selectDistinctOn([salesPrices.itemCode], hitSelection)
    .from(salesPrices)
    .where(and(...liveConditions(family), sql`${nameSql} ilike ${likePattern(anchor)}`))
    .orderBy(salesPrices.itemCode, desc(salesPrices.effectiveFrom), desc(salesPrices.id))
    .limit(PREFILTER_LIMIT);
  const hits = matchByTokens(rows, term).sort((a, b) => a.itemName.localeCompare(b.itemName, 'ko'));
  return { hits, exactCode: false };
}

/** 여러 후보 문자열(별칭 포함)을 차례로 검색해 처음 결과가 있는 것을 돌려준다 */
export async function findChatItemsByTerms(
  db: Db,
  terms: readonly string[],
  family: string | null = null,
): Promise<ChatItemSearch> {
  for (const term of terms) {
    const found = await findChatItems(db, term, family);
    if (found.hits.length > 0) return found;
  }
  return { hits: [], exactCode: false };
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
