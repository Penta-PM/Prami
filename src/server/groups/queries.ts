import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { items, salesPrices, solutionGroupItems, solutionGroups } from '@/db/schema';

/**
 * 솔루션 그룹 조회 (§4.3.7, §4.5.6). 항목 가격은 저장하지 않고 조회 시점의 `sales_prices` 최신 `정상판매`
 * (운영중, 거래처 무관) 행에서 가져온다 — 견적 계산기(PR-7 AC-33) 그룹 칩도 같은 함수를 쓴다.
 */
export type GroupItemView = {
  itemCode: string;
  itemName: string;
  defaultQty: number;
  /** 최신 정상판매가. 없으면 null (가격 미등록) */
  unitPrice: string | null;
  currency: string | null;
};

export type SolutionGroupView = {
  id: string;
  productFamily: string;
  name: string;
  items: GroupItemView[];
};

export type GroupCandidate = {
  itemCode: string;
  itemName: string;
  unitPrice: string;
  currency: string;
};

/** 품번의 최신 정상판매(운영중) 단가 */
const LATEST_PRICE_SQL = (code: typeof items.itemCode) => sql<string | null>`(
  select sp.unit_price::text from sales_prices sp
  where sp.item_code = ${code} and sp.deleted_at is null and sp.price_type = '정상판매'
    and sp.operation_status = '운영중'
  order by sp.effective_from desc, sp.id desc limit 1)`;
const LATEST_CURRENCY_SQL = (code: typeof items.itemCode) => sql<string | null>`(
  select sp.currency from sales_prices sp
  where sp.item_code = ${code} and sp.deleted_at is null and sp.price_type = '정상판매'
    and sp.operation_status = '운영중'
  order by sp.effective_from desc, sp.id desc limit 1)`;

export async function listSolutionGroups(db: Db, family?: string): Promise<SolutionGroupView[]> {
  const conditions = [isNull(solutionGroups.deletedAt)];
  if (family) conditions.push(eq(solutionGroups.productFamily, family));
  const groups = await db
    .select({
      id: solutionGroups.id,
      productFamily: solutionGroups.productFamily,
      name: solutionGroups.name,
    })
    .from(solutionGroups)
    .where(and(...conditions))
    .orderBy(
      asc(solutionGroups.productFamily),
      asc(solutionGroups.name),
      asc(solutionGroups.createdAt),
    );
  if (groups.length === 0) return [];
  const rows = await db
    .select({
      groupId: solutionGroupItems.groupId,
      itemCode: solutionGroupItems.itemCode,
      itemName: items.itemName,
      defaultQty: solutionGroupItems.defaultQty,
      sortOrder: solutionGroupItems.sortOrder,
      unitPrice: LATEST_PRICE_SQL(items.itemCode),
      currency: LATEST_CURRENCY_SQL(items.itemCode),
    })
    .from(solutionGroupItems)
    .innerJoin(items, eq(items.itemCode, solutionGroupItems.itemCode))
    .innerJoin(solutionGroups, eq(solutionGroups.id, solutionGroupItems.groupId))
    .where(and(...conditions))
    .orderBy(asc(solutionGroupItems.sortOrder), asc(solutionGroupItems.itemCode));
  const byGroup = new Map<string, GroupItemView[]>();
  for (const row of rows) {
    const list = byGroup.get(row.groupId) ?? [];
    list.push({
      itemCode: row.itemCode,
      itemName: row.itemName,
      defaultQty: row.defaultQty,
      unitPrice: row.unitPrice,
      currency: row.currency,
    });
    byGroup.set(row.groupId, list);
  }
  return groups.map((group) => ({ ...group, items: byGroup.get(group.id) ?? [] }));
}

export async function getSolutionGroup(db: Db, id: string): Promise<SolutionGroupView | null> {
  const [group] = await db
    .select({ productFamily: solutionGroups.productFamily })
    .from(solutionGroups)
    .where(and(eq(solutionGroups.id, id), isNull(solutionGroups.deletedAt)));
  if (!group) return null;
  const list = await listSolutionGroups(db, group.productFamily);
  return list.find((entry) => entry.id === id) ?? null;
}

/** 그룹 모달 후보: 제품군의 운영중 정상판매 품목 + 최신 가격 (§4.5.6) */
export async function listGroupCandidates(db: Db, family: string): Promise<GroupCandidate[]> {
  const rows = await db
    .selectDistinctOn([salesPrices.itemCode], {
      itemCode: salesPrices.itemCode,
      itemName: sql<string>`coalesce(${items.itemName}, ${salesPrices.itemName})`,
      unitPrice: salesPrices.unitPrice,
      currency: salesPrices.currency,
    })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(
      and(
        isNull(salesPrices.deletedAt),
        eq(salesPrices.productFamily, family),
        eq(salesPrices.priceType, '정상판매'),
        eq(salesPrices.operationStatus, '운영중'),
      ),
    )
    .orderBy(salesPrices.itemCode, desc(salesPrices.effectiveFrom), desc(salesPrices.id));
  return rows.sort((a, b) => a.itemName.localeCompare(b.itemName, 'ko'));
}

/** 견적 계산기 그룹 칩 (AC-33 서버 부분): 제품군의 그룹 + 항목·현재 단가 */
export async function listGroupChips(db: Db, family: string): Promise<SolutionGroupView[]> {
  return listSolutionGroups(db, family);
}
