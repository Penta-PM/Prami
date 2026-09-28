import { z } from 'zod';

import { getDbHandle } from '@/db';
import { AppError } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { writeAudit } from '@/server/audit/log';
import { runRoute } from '@/server/auth/rbac';
import { loadQuoteDocument } from '@/server/quotes/document';
import { findAccessibleQuote, type QuotesContext } from '@/server/quotes/mutations';
import { pdfFilename, renderQuotePdf } from '@/server/quotes/pdf/render';

/**
 * GET /api/quotes/[id]/pdf (§4.5.8, §4.7, AC-70·72): 소유자 또는 ADMIN 에게 A4 견적서 PDF.
 * 타인 견적은 403 + 감사 denied(quote.pdf), 없는 견적은 404. 성공도 감사에 남긴다(quote.pdf, 렌더 시간 포함).
 * 저장된 스냅샷(서버 재가격화 이후 값)만 읽으며 원가는 문서 모델에 없다.
 */
export const AUDIT_QUOTE_PDF = 'quote.pdf';

const idSchema = z.uuid();

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const guard = {
    permission: 'calculator.use',
    auditAction: AUDIT_QUOTE_PDF,
    target: `/api/quotes/${id}/pdf`,
  } as const;
  return runRoute(guard, async (user) => {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) throw new AppError('NOT_FOUND', '견적을 찾을 수 없습니다');
    const ctx: QuotesContext = {
      handle: await getDbHandle(),
      actor: { id: user.id, label: user.email, role: user.role },
      meta: await currentRequestMeta(),
    };
    const quote = await findAccessibleQuote(ctx, parsed.data, AUDIT_QUOTE_PDF);
    const document = await loadQuoteDocument(ctx.handle.db, quote.id);
    if (!document) throw new AppError('NOT_FOUND', '견적을 찾을 수 없습니다');
    const rendered = await renderQuotePdf(document);
    await writeAudit(ctx.handle.db, {
      actor: ctx.actor,
      action: AUDIT_QUOTE_PDF,
      target: { type: 'quote', id: quote.id, label: quote.quoteNo },
      after: { bytes: rendered.buffer.byteLength, durationMs: rendered.durationMs },
      meta: ctx.meta,
    });
    return new Response(new Uint8Array(rendered.buffer), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${pdfFilename(quote.quoteNo)}"`,
        'content-length': String(rendered.buffer.byteLength),
        'cache-control': 'private, no-store',
        'x-render-ms': String(rendered.durationMs),
      },
    });
  });
}
