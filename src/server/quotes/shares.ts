import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { firstRow } from '@/db/rows';
import { quoteShares, quotes } from '@/db/schema';
import { withTransaction } from '@/db/tx';
import { AppError } from '@/lib/result';
import { writeAudit } from '@/server/audit/log';

import { loadQuoteDocument, type QuoteDocument } from './document';
import { findAccessibleQuote, type QuotesContext } from './mutations';

/**
 * 견적 공유 링크 (§4.3.8 quote_shares, §4.5.8, AC-71, Q-13):
 * - 토큰 = 32바이트 난수(hex 64자), 만료 기본 30일(최대 365일).
 * - 폐기 = `expires_at` 을 지금으로 당긴다 (행·감사는 남고 링크만 즉시 404) — 스키마 변경 없음.
 * - 시계는 **DB 하나**(PRAMI-003 AC-371, AC-71 간헐 실패 원인): 폐기 시각·활성 판정·공개 조회 비교를 모두 SQL `now()` 로 한다.
 *   앱 시계(`new Date()`)로 폐기 시각을 쓰고 DB 시계로 비교하면, 앱 시계가 DB 보다 앞선 만큼 폐기된 링크가 열려 있었다
 *   (컨테이너 시계 차이·다중 인스턴스). 생성 시 만료일(일 단위)만 앱 시계로 계산한다.
 * - 공유 페이지는 토큰이 살아 있고 견적이 삭제되지 않았을 때만 문서를 돌려주며 원가는 문서 모델에 없다.
 */
export const AUDIT_QUOTE_SHARE_CREATE = 'quote.share.create';
export const AUDIT_QUOTE_SHARE_REVOKE = 'quote.share.revoke';
export const AUDIT_QUOTE_SHARE_LIST = 'quote.share.list';

export const SHARE_DEFAULT_DAYS = 30;
export const SHARE_MAX_DAYS = 365;
export const SHARE_TOKEN_BYTES = 32;
export const SHARE_TOKEN_RE = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const createShareSchema = z.object({
  quoteId: z.uuid(),
  expiresInDays: z.coerce.number().int().min(1).max(SHARE_MAX_DAYS).default(SHARE_DEFAULT_DAYS),
});
export const revokeShareSchema = z.object({ shareId: z.uuid() });
export const listSharesSchema = z.object({ quoteId: z.uuid() });

export type CreateShareInput = z.input<typeof createShareSchema>;
export type RevokeShareInput = z.input<typeof revokeShareSchema>;
export type ListSharesInput = z.input<typeof listSharesSchema>;

export type QuoteShareView = {
  id: string;
  quoteId: string;
  quoteNo: string;
  token: string;
  path: string;
  expiresAt: string;
  createdAt: string;
  isActive: boolean;
};

export function sharePath(token: string): string {
  return `/share/quotes/${token}`;
}

/** DB 시계 기준 활성 여부 — 조회 열 (`expires_at > now()`) */
const isActiveSql = sql<boolean>`${quoteShares.expiresAt} > now()`;

function toView(
  row: typeof quoteShares.$inferSelect,
  quoteNo: string,
  isActive: boolean,
): QuoteShareView {
  return {
    id: row.id,
    quoteId: row.quoteId,
    quoteNo,
    token: row.token,
    path: sharePath(row.token),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    isActive,
  };
}

export async function createQuoteShare(
  ctx: QuotesContext,
  raw: CreateShareInput,
): Promise<QuoteShareView> {
  const input = createShareSchema.parse(raw);
  const quote = await findAccessibleQuote(ctx, input.quoteId, AUDIT_QUOTE_SHARE_CREATE);
  const token = randomBytes(SHARE_TOKEN_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + input.expiresInDays * DAY_MS);
  return withTransaction(async (tx) => {
    const created = firstRow(
      await tx
        .insert(quoteShares)
        .values({ quoteId: quote.id, token, expiresAt, createdBy: ctx.actor.id })
        .returning(),
      'quote_shares insert',
    );
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_QUOTE_SHARE_CREATE,
      target: { type: 'quote', id: quote.id, label: quote.quoteNo },
      // 토큰 자체는 감사 로그에 남기지 않는다 (링크 = 접근 권한)
      after: { shareId: created.id, expiresAt: expiresAt.toISOString(), days: input.expiresInDays },
      meta: ctx.meta,
    });
    // 방금 만든 링크는 만료일이 1일 이상 뒤다
    return toView(created, quote.quoteNo, true);
  }, ctx.handle);
}

export async function revokeQuoteShare(
  ctx: QuotesContext,
  raw: RevokeShareInput,
): Promise<QuoteShareView> {
  const { shareId } = revokeShareSchema.parse(raw);
  const [share] = await ctx.handle.db.select().from(quoteShares).where(eq(quoteShares.id, shareId));
  if (!share) throw new AppError('NOT_FOUND', '공유 링크를 찾을 수 없습니다');
  const quote = await findAccessibleQuote(ctx, share.quoteId, AUDIT_QUOTE_SHARE_REVOKE);
  return withTransaction(async (tx) => {
    // 폐기 시각 = DB 시계 (공개 조회 비교와 같은 시계 — AC-371). 저장된 값은 returning 으로 받는다
    const [updated] = await tx
      .update(quoteShares)
      .set({ expiresAt: sql`now()` })
      .where(and(eq(quoteShares.id, shareId), gt(quoteShares.expiresAt, sql`now()`)))
      .returning();
    if (!updated) throw new AppError('CONFLICT', '이미 만료·폐기된 링크입니다');
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_QUOTE_SHARE_REVOKE,
      target: { type: 'quote', id: quote.id, label: quote.quoteNo },
      before: { shareId, expiresAt: share.expiresAt.toISOString() },
      after: { shareId, expiresAt: updated.expiresAt.toISOString() },
      meta: ctx.meta,
    });
    return toView(updated, quote.quoteNo, false);
  }, ctx.handle);
}

/** 견적의 공유 링크 목록 (최신순). 접근 권한은 견적과 같다 */
export async function listQuoteShares(
  ctx: QuotesContext,
  raw: ListSharesInput,
): Promise<QuoteShareView[]> {
  const { quoteId } = listSharesSchema.parse(raw);
  const quote = await findAccessibleQuote(ctx, quoteId, AUDIT_QUOTE_SHARE_LIST);
  const rows = await ctx.handle.db
    .select({ share: quoteShares, isActive: isActiveSql })
    .from(quoteShares)
    .where(eq(quoteShares.quoteId, quoteId))
    .orderBy(desc(quoteShares.createdAt));
  return rows.map((row) => toView(row.share, quote.quoteNo, row.isActive === true));
}

export type SharedQuote = { document: QuoteDocument; expiresAt: string };

/** 공개 페이지용: 살아 있는 토큰 + 삭제되지 않은 견적일 때만. 만료·폐기·삭제·형식 오류는 모두 null (→ 404) */
export async function findSharedQuote(
  db: QuotesContext['handle']['db'],
  token: string,
): Promise<SharedQuote | null> {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select({ quoteId: quoteShares.quoteId, expiresAt: quoteShares.expiresAt })
    .from(quoteShares)
    .innerJoin(quotes, eq(quotes.id, quoteShares.quoteId))
    .where(
      and(
        eq(quoteShares.token, token),
        gt(quoteShares.expiresAt, sql`now()`),
        isNull(quotes.deletedAt),
      ),
    );
  if (!row) return null;
  const document = await loadQuoteDocument(db, row.quoteId);
  return document ? { document, expiresAt: row.expiresAt.toISOString() } : null;
}
