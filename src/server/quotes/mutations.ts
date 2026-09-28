import 'server-only';

import { and, desc, eq, isNull, like, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { quoteLines, quotes, type Quote } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { hasPermission, type Role } from '@/lib/constants/permissions';
import { computeLine, unitWithOptions } from '@/lib/pricing/quote';
import { AppError } from '@/lib/result';
import { writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';

import { repriceLines, type PriceAdjustment, type RepriceResult } from './reprice';
import {
  deleteQuoteSchema,
  saveQuoteSchema,
  type DeleteQuoteInput,
  type SaveQuoteInput,
} from './schemas';

/**
 * 견적 저장·삭제 (§4.3.8, §4.5.7, AC-63·66). 단가는 서버가 DB 운영중 최신 행으로 다시 확정하고(reprice.ts, PR-7 QA MEDIUM)
 * 라인에 그 스냅샷을 저장하며 금액은 순수 함수로 다시 계산한다. 클라이언트 단가와 다르면 `adjustments` 로 알린다.
 * 견적 번호 `Q-YYYY-NNNN` 은 연도별 시퀀스 — 트랜잭션 advisory lock + 연도 최대값 + 1, UNIQUE 충돌 시 재시도.
 */
export type QuotesContext = {
  handle: DbHandle;
  actor: AuditActor & { id: string; role: Role };
  meta: RequestMeta;
};

export const AUDIT_QUOTE_SAVE = 'quote.save';
export const AUDIT_QUOTE_DELETE = 'quote.delete';

export type SavedQuoteResult = {
  id: string;
  quoteNo: string;
  totalAmount: string;
  currency: string | null;
  lineCount: number;
  /** 서버 재가격화로 보정된 항목 (비어 있으면 클라이언트 값과 일치) */
  adjustments: PriceAdjustment[];
};

const QUOTE_NO_LOCK_KEY = 20_260_929;
const MAX_RETRY = 5;
const QUOTE_NO_RE = /^Q-(\d{4})-(\d{4})$/;

function parseSeq(quoteNo: string | null | undefined): number {
  const match = quoteNo ? QUOTE_NO_RE.exec(quoteNo) : null;
  return match ? Number(match[2]) : 0;
}

/** 같은 연도의 최대 시퀀스 + 1 (삭제된 견적 포함, 번호 재사용 없음) */
export async function nextQuoteNo(tx: Tx, year: number): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(${QUOTE_NO_LOCK_KEY})`);
  const [row] = await tx
    .select({ quoteNo: quotes.quoteNo })
    .from(quotes)
    .where(like(quotes.quoteNo, `Q-${year}-%`))
    .orderBy(desc(quotes.quoteNo))
    .limit(1);
  const seq = parseSeq(row?.quoteNo) + 1;
  if (seq > 9999) throw new AppError('CONFLICT', `${year}년 견적 번호가 모두 사용되었습니다`);
  return `Q-${year}-${String(seq).padStart(4, '0')}`;
}

type ParsedLine = ReturnType<typeof saveQuoteSchema.parse>['lines'][number];

function lineAmounts(line: ParsedLine) {
  const groupOptions = line.groupItems.map((item) => ({
    ...item,
    unitPrice: item.unitPrice * item.qty,
  }));
  const amounts = computeLine({
    basePrice: line.unitPrice,
    parts: [...line.parts, ...groupOptions],
    bundles: line.bundles,
    qty: line.qty,
    discountRate: line.discountRate,
    currency: line.currency,
  });
  return {
    ...amounts,
    optionUnit: unitWithOptions({
      basePrice: 0,
      parts: [...line.parts, ...groupOptions],
      bundles: line.bundles,
    }),
  };
}

function summarize(lines: readonly ParsedLine[]): string {
  const [first, ...rest] = lines;
  const head = first ? `${first.name} × ${first.qty}` : '';
  return rest.length > 0 ? `${head} 외 ${rest.length}건` : head;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === '23505' || causeCode === '23505';
}

/** 제품군·제목: 라인 본품의 제품군이 하나면 그것, 여럿이면 '복수 제품군' (PR-7 QA INFO-3) */
function headOf(
  input: ReturnType<typeof saveQuoteSchema.parse>,
  families: readonly string[],
  quoteNo: string,
) {
  const productFamily = families.length === 1 ? families[0]! : input.productFamily;
  const defaultTitle =
    families.length > 1
      ? `복수 제품군(${families.join(', ')}) 견적 ${quoteNo}`
      : `${productFamily} 견적 ${quoteNo}`;
  return { productFamily, title: input.title || defaultTitle };
}

async function insertQuote(
  ctx: QuotesContext,
  input: ReturnType<typeof saveQuoteSchema.parse>,
  priced: RepriceResult,
) {
  const computed = priced.lines.map((line) => ({ line, amounts: lineAmounts(line) }));
  const currencies = new Set(computed.map(({ line }) => line.currency));
  const total = computed.reduce((sum, { amounts }) => sum + amounts.lineTotal, 0);
  const currency = currencies.size === 1 ? [...currencies][0]! : null;
  return withTransaction(async (tx) => {
    const quoteNo = await nextQuoteNo(tx, new Date().getFullYear());
    const head = headOf(input, priced.families, quoteNo);
    const created = firstRow(
      await tx
        .insert(quotes)
        .values({
          quoteNo,
          ownerUserId: ctx.actor.id,
          productFamily: head.productFamily,
          title: head.title,
          summary: summarize(priced.lines),
          // 통화 혼합이면 단일 합계를 두지 않는다 (AC-65)
          totalAmount: currency ? String(Math.round(total)) : null,
          currency,
          status: 'saved',
        })
        .returning(),
      'quotes insert',
    );
    await tx.insert(quoteLines).values(
      computed.map(({ line, amounts }, index) => ({
        quoteId: created.id,
        lineNo: index + 1,
        kind: line.kind,
        itemCode: line.itemCode ?? null,
        groupId: line.groupId ?? null,
        priceType: line.priceType ?? null,
        qty: line.qty,
        unitPrice: line.unitPrice.toFixed(2),
        options: {
          name: line.name,
          currency: line.currency,
          parts: line.parts,
          bundles: line.bundles,
          groupItems: line.groupItems,
          optionUnit: amounts.optionUnit,
        },
        discountRate: line.discountRate.toFixed(1),
        preDiscount: amounts.preDiscount.toFixed(2),
        lineTotal: amounts.lineTotal.toFixed(2),
      })),
    );
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_QUOTE_SAVE,
      target: { type: 'quote', id: created.id, label: quoteNo },
      after: {
        quoteNo,
        productFamily: head.productFamily,
        lineCount: priced.lines.length,
        totalAmount: created.totalAmount,
        currency,
        adjustments: priced.adjustments.length,
      },
      meta: ctx.meta,
    });
    return {
      id: created.id,
      quoteNo,
      totalAmount: created.totalAmount ?? String(Math.round(total)),
      currency,
      lineCount: priced.lines.length,
      adjustments: priced.adjustments,
    };
  }, ctx.handle);
}

export async function saveQuote(
  ctx: QuotesContext,
  raw: SaveQuoteInput,
): Promise<SavedQuoteResult> {
  const input = saveQuoteSchema.parse(raw);
  const priced = await repriceLines(ctx.handle.db, input.lines);
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
    try {
      return await insertQuote(ctx, input, priced);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }
  throw new AppError('CONFLICT', '견적 번호 발급이 반복 충돌했습니다. 다시 시도하세요', undefined, {
    cause: String(lastError),
  });
}

/**
 * 본인 견적만, ADMIN 은 전체 (§4.5.7). 남의 견적이면 시도한 행위 키로 감사 denied 를 남기고 FORBIDDEN (§4.7.1 관찰 결과 ③).
 * 삭제·PDF·공유 생성/폐기가 공통으로 쓴다.
 */
export async function findAccessibleQuote(
  ctx: QuotesContext,
  id: string,
  auditAction: string,
): Promise<Quote> {
  const [row] = await ctx.handle.db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, id), isNull(quotes.deletedAt)));
  if (!row) throw new AppError('NOT_FOUND', '견적을 찾을 수 없습니다');
  if (row.ownerUserId !== ctx.actor.id && !hasPermission(ctx.actor.role, 'users.manage')) {
    await writeAudit(ctx.handle.db, {
      actor: ctx.actor,
      action: auditAction,
      target: { type: 'quote', id, label: row.quoteNo },
      reason: '다른 사용자의 견적',
      result: 'denied',
      meta: ctx.meta,
    });
    throw new AppError('FORBIDDEN', '다른 사용자의 견적입니다');
  }
  return row;
}

export async function deleteQuote(ctx: QuotesContext, raw: DeleteQuoteInput) {
  const { id } = deleteQuoteSchema.parse(raw);
  const before = await findAccessibleQuote(ctx, id, AUDIT_QUOTE_DELETE);
  return withTransaction(async (tx) => {
    await tx
      .update(quotes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(quotes.id, id));
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_QUOTE_DELETE,
      target: { type: 'quote', id, label: before.quoteNo },
      before: { quoteNo: before.quoteNo, totalAmount: before.totalAmount },
      after: { deletedAt: 'now' },
      meta: ctx.meta,
    });
    return { id, quoteNo: before.quoteNo };
  }, ctx.handle);
}
