import { and, asc, eq, isNull } from 'drizzle-orm';

import type { Db } from '@/db';
import { quoteLines, quotes, users } from '@/db/schema';
import { cartTotals } from '@/lib/pricing/quote';

/**
 * 견적서 문서 모델 (§4.5.8): PDF 와 공유 페이지가 함께 쓰는 읽기 전용 스냅샷.
 * 저장된 `quotes`/`quote_lines` 만 읽는다 — 원가는 어디에도 없다 (AC-43, AC-71).
 */
export type QuoteDocumentOption = {
  label: '파츠' | '결합형' | '상세';
  itemCode: string;
  name: string;
  unitPrice: number;
  qty: number;
};

export type QuoteDocumentLine = {
  lineNo: number;
  kind: 'item' | 'group';
  name: string;
  itemCode: string | null;
  priceType: string | null;
  qty: number;
  unitPrice: string;
  currency: string;
  discountRate: string;
  preDiscount: string;
  lineTotal: string;
  options: QuoteDocumentOption[];
};

export type QuoteDocument = {
  id: string;
  quoteNo: string;
  title: string;
  productFamily: string | null;
  summary: string | null;
  /** 통화가 하나면 합계, 섞이면 null (AC-65) */
  totalAmount: string | null;
  currency: string | null;
  subtotals: { currency: string; amount: number }[];
  createdAt: string;
  ownerName: string;
  lines: QuoteDocumentLine[];
};

type Options = {
  name?: string;
  currency?: string;
  parts?: { itemCode: string; itemName: string; unitPrice: number }[];
  bundles?: { itemCode: string; itemName: string; unitPrice: number }[];
  groupItems?: { itemCode: string; itemName: string; unitPrice: number; qty: number }[];
};

function optionsOf(raw: unknown): QuoteDocumentOption[] {
  const options = (raw ?? {}) as Options;
  const map = (
    label: QuoteDocumentOption['label'],
    list: { itemCode: string; itemName: string; unitPrice: number; qty?: number }[] = [],
  ) =>
    list.map((entry) => ({
      label,
      itemCode: entry.itemCode,
      name: entry.itemName,
      unitPrice: entry.unitPrice,
      qty: entry.qty ?? 1,
    }));
  return [
    ...map('파츠', options.parts),
    ...map('결합형', options.bundles),
    ...map('상세', options.groupItems),
  ];
}

/** 삭제되지 않은 견적의 문서 모델. 없으면 null — 접근 권한은 호출자가 먼저 확인한다 */
export async function loadQuoteDocument(db: Db, quoteId: string): Promise<QuoteDocument | null> {
  const [head] = await db
    .select({ quote: quotes, ownerName: users.name })
    .from(quotes)
    .leftJoin(users, eq(users.id, quotes.ownerUserId))
    .where(and(eq(quotes.id, quoteId), isNull(quotes.deletedAt)));
  if (!head) return null;
  const rows = await db
    .select()
    .from(quoteLines)
    .where(eq(quoteLines.quoteId, quoteId))
    .orderBy(asc(quoteLines.lineNo));
  const lines = rows.map((row) => {
    const options = (row.options ?? {}) as Options;
    return {
      lineNo: row.lineNo,
      kind: row.kind,
      name: options.name ?? row.itemCode ?? '',
      itemCode: row.itemCode,
      priceType: row.priceType,
      qty: row.qty,
      unitPrice: row.unitPrice,
      currency: options.currency ?? 'KRW',
      discountRate: row.discountRate,
      preDiscount: row.preDiscount,
      lineTotal: row.lineTotal,
      options: optionsOf(row.options),
    };
  });
  const totals = cartTotals(
    lines.map((line) => ({ currency: line.currency, lineTotal: Number(line.lineTotal) })),
  );
  return {
    id: head.quote.id,
    quoteNo: head.quote.quoteNo,
    title: head.quote.title,
    productFamily: head.quote.productFamily,
    summary: head.quote.summary,
    totalAmount: head.quote.totalAmount,
    currency: head.quote.currency,
    subtotals: totals.subtotals,
    createdAt: head.quote.createdAt.toISOString(),
    ownerName: head.ownerName ?? '—',
    lines,
  };
}
