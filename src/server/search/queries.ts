import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { items, notices, salesPrices } from '@/db/schema';

/**
 * 상단 통합 검색 (§4.5.4, Q-14: 품목 + 공지). 원가(material_costs)는 어떤 경우에도 조인·반환하지 않는다 (AC-43).
 * 품목은 판매단가에 등장하는 품번 기준으로 품번당 1건(최근 적용시작일 행), 품목 마스터가 있으면 상태를 덧붙인다.
 */
export type ItemHit = {
  itemCode: string;
  itemName: string;
  productFamily: string;
  itemStatus: string | null;
};

export type NoticeHit = {
  id: string;
  title: string;
  authorName: string;
  isImportant: boolean;
  publishedAt: string;
};

export type SearchResult = { query: string; items: ItemHit[]; notices: NoticeHit[] };

export const SEARCH_LIMIT = 20;
const MAX_QUERY = 100;

/** 검색어 정규화: 공백 정리, 길이 제한, LIKE 와일드카드는 문자 그대로 */
export function normalizeQuery(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
}

function pattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

async function searchItems(db: Db, like: string): Promise<ItemHit[]> {
  return db
    .selectDistinctOn([salesPrices.itemCode], {
      itemCode: salesPrices.itemCode,
      itemName: salesPrices.itemName,
      productFamily: salesPrices.productFamily,
      itemStatus: sql<string | null>`${items.itemStatus}::text`,
    })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(
      and(
        isNull(salesPrices.deletedAt),
        or(ilike(salesPrices.itemName, like), ilike(salesPrices.itemCode, like)),
      ),
    )
    .orderBy(salesPrices.itemCode, desc(salesPrices.effectiveFrom))
    .limit(SEARCH_LIMIT);
}

async function searchNotices(db: Db, like: string): Promise<NoticeHit[]> {
  return db
    .select({
      id: notices.id,
      title: notices.title,
      authorName: notices.authorName,
      isImportant: notices.isImportant,
      publishedAt: notices.publishedAt,
    })
    .from(notices)
    .where(
      and(isNull(notices.deletedAt), or(ilike(notices.title, like), ilike(notices.body, like))),
    )
    .orderBy(desc(notices.publishedAt), desc(notices.createdAt))
    .limit(SEARCH_LIMIT);
}

export async function searchAll(db: Db, rawQuery: string): Promise<SearchResult> {
  const query = normalizeQuery(rawQuery);
  if (!query) return { query, items: [], notices: [] };
  const like = pattern(query);
  const [itemHits, noticeHits] = await Promise.all([
    searchItems(db, like),
    searchNotices(db, like),
  ]);
  return { query, items: itemHits, notices: noticeHits };
}
