'use server';

import { z } from 'zod';

import { getDb, getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';
import {
  listQuoteBundles,
  listQuoteCategories,
  listQuoteItems,
  listQuoteParts,
  type CategoryChips,
  type QuoteItem,
} from '@/server/quotes/catalog';
import {
  AUDIT_QUOTE_DELETE,
  AUDIT_QUOTE_SAVE,
  deleteQuote,
  saveQuote,
  type QuotesContext,
  type SavedQuoteResult,
} from '@/server/quotes/mutations';
import { listMyQuotes, type SavedQuote } from '@/server/quotes/queries';
import type { DeleteQuoteInput, SaveQuoteInput } from '@/server/quotes/schemas';

/**
 * 견적 계산기 Server Actions (§4.7 `saveQuote`/`deleteQuote`, calculator.use = USER 이상).
 * 후보 조회는 운영중 판매단가만 보며 원가는 절대 싣지 않는다 (AC-43). 순매출 계산은 features/costs 의 Action 을 쓴다.
 */
const itemFilterSchema = z.object({
  family: z.string().trim().min(1).max(50),
  priceType: z.string().trim().min(1).max(100),
  mid: z.string().trim().max(100).optional(),
  minor: z.string().trim().max(100).optional(),
});

const partsFilterSchema = itemFilterSchema.extend({
  modelItemCode: z.string().trim().min(1).max(50),
});

const categorySchema = z.object({
  family: z.string().trim().min(1).max(50),
  mid: z.string().trim().max(100).optional(),
});

async function context(actor: SessionUser): Promise<QuotesContext> {
  return {
    handle: await getDbHandle(),
    actor: { id: actor.id, label: actor.email, role: actor.role },
    meta: await currentRequestMeta(),
  };
}

const read = { permission: 'calculator.use', auditAction: 'quote.read' } as const;

export async function listQuoteItemsAction(
  input: z.input<typeof itemFilterSchema>,
): Promise<ActionResult<QuoteItem[]>> {
  return runAction({ ...read, name: 'listQuoteItems' }, async () =>
    listQuoteItems(await getDb(), itemFilterSchema.parse(input)),
  );
}

export async function listQuoteOptionsAction(
  input: z.input<typeof partsFilterSchema>,
): Promise<ActionResult<{ parts: QuoteItem[]; mapped: boolean; bundles: QuoteItem[] }>> {
  return runAction({ ...read, name: 'listQuoteOptions' }, async () => {
    const filter = partsFilterSchema.parse(input);
    const db = await getDb();
    const [parts, bundles] = await Promise.all([
      listQuoteParts(db, filter),
      listQuoteBundles(db, filter),
    ]);
    return { ...parts, bundles };
  });
}

export async function listQuoteCategoriesAction(
  input: z.input<typeof categorySchema>,
): Promise<ActionResult<CategoryChips>> {
  return runAction({ ...read, name: 'listQuoteCategories' }, async () => {
    const { family, mid } = categorySchema.parse(input);
    return listQuoteCategories(await getDb(), family, { mid });
  });
}

export async function saveQuoteAction(
  input: SaveQuoteInput,
): Promise<ActionResult<SavedQuoteResult>> {
  return runAction(
    { permission: 'calculator.use', auditAction: AUDIT_QUOTE_SAVE, name: 'saveQuote' },
    async (actor) => saveQuote(await context(actor), input),
  );
}

export async function listMyQuotesAction(): Promise<ActionResult<SavedQuote[]>> {
  return runAction({ ...read, name: 'listMyQuotes' }, async (actor) =>
    listMyQuotes(await getDb(), actor),
  );
}

export async function deleteQuoteAction(
  input: DeleteQuoteInput,
): Promise<ActionResult<{ id: string; quoteNo: string }>> {
  return runAction(
    { permission: 'calculator.use', auditAction: AUDIT_QUOTE_DELETE, name: 'deleteQuote' },
    async (actor) => deleteQuote(await context(actor), input),
  );
}
