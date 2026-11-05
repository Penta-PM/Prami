import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { Db } from '@/db';
import { quoteLines, quotes } from '@/db/schema';
import { hasPermission, type Role } from '@/lib/constants/permissions';
import type { CoreSnapshot } from '@/lib/pricing/quote';

/** 내 견적 목록 (§4.5.7): 소유자 본인 것만, ADMIN 은 전체. 라인 스냅샷은 담기(복원)에 쓴다 */
export type SavedQuoteLine = {
  lineNo: number;
  kind: 'item' | 'group';
  itemCode: string | null;
  groupId: string | null;
  priceType: string | null;
  name: string;
  qty: number;
  unitPrice: string;
  currency: string;
  parts: { itemCode: string; itemName: string; unitPrice: number }[];
  bundles: { itemCode: string; itemName: string; unitPrice: number }[];
  groupItems: { itemCode: string; itemName: string; unitPrice: number; qty: number }[];
  discountRate: string;
  preDiscount: string;
  lineTotal: string;
  /** 코어 스냅샷 (D.AMO 코어 단가 §4) — 담기 때 코어 수 복원. 옛 견적·코어 미적용 = null */
  core?: CoreSnapshot | null;
};

export type SavedQuote = {
  id: string;
  quoteNo: string;
  productFamily: string | null;
  title: string;
  summary: string | null;
  totalAmount: string | null;
  currency: string | null;
  createdAt: string;
  ownerUserId: string;
  lines: SavedQuoteLine[];
};

type Options = {
  name?: string;
  currency?: string;
  parts?: SavedQuoteLine['parts'];
  bundles?: SavedQuoteLine['bundles'];
  groupItems?: SavedQuoteLine['groupItems'];
  core?: CoreSnapshot;
};

export async function listMyQuotes(
  db: Db,
  user: { id: string; role: Role },
  limit = 100,
): Promise<SavedQuote[]> {
  const conditions = [isNull(quotes.deletedAt)];
  if (!hasPermission(user.role, 'users.manage')) conditions.push(eq(quotes.ownerUserId, user.id));
  const heads = await db
    .select()
    .from(quotes)
    .where(and(...conditions))
    .orderBy(desc(quotes.createdAt))
    .limit(limit);
  if (heads.length === 0) return [];
  const lines = await db
    .select()
    .from(quoteLines)
    .where(
      inArray(
        quoteLines.quoteId,
        heads.map((head) => head.id),
      ),
    )
    .orderBy(asc(quoteLines.lineNo));
  const byQuote = new Map<string, SavedQuoteLine[]>();
  for (const line of lines) {
    const options = (line.options ?? {}) as Options;
    const list = byQuote.get(line.quoteId) ?? [];
    list.push({
      lineNo: line.lineNo,
      kind: line.kind,
      itemCode: line.itemCode,
      groupId: line.groupId,
      priceType: line.priceType,
      name: options.name ?? line.itemCode ?? '',
      qty: line.qty,
      unitPrice: line.unitPrice,
      currency: options.currency ?? 'KRW',
      parts: options.parts ?? [],
      bundles: options.bundles ?? [],
      groupItems: options.groupItems ?? [],
      discountRate: line.discountRate,
      preDiscount: line.preDiscount,
      lineTotal: line.lineTotal,
      core: options.core ?? null,
    });
    byQuote.set(line.quoteId, list);
  }
  return heads.map((head) => ({
    id: head.id,
    quoteNo: head.quoteNo,
    productFamily: head.productFamily,
    title: head.title,
    summary: head.summary,
    totalAmount: head.totalAmount,
    currency: head.currency,
    createdAt: head.createdAt.toISOString(),
    ownerUserId: head.ownerUserId,
    lines: byQuote.get(head.id) ?? [],
  }));
}
