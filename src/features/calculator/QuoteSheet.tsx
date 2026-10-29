import { Pill } from '@/components/ui';
import { formatDate } from '@/lib/date-format';
import { priceLabel } from '@/lib/pricing/format';

import type { QuoteDocumentView } from './types';

/**
 * 읽기 전용 견적서 (공유 페이지 §4.5.8, AC-71). 서버 컴포넌트에서 그대로 쓸 수 있다 — 상태 없음.
 * 문서 모델(QuoteDocument)에 원가가 없으므로 이 화면에도 원가는 없다.
 */
export function QuoteSheet({ document }: { document: QuoteDocumentView }) {
  return (
    <article aria-labelledby="quote-sheet-title" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-[12px] font-semibold text-text-tertiary">견적서</p>
          <h1 id="quote-sheet-title" className="m-0 mt-1 [font:var(--text-h2)]">
            {document.title}
          </h1>
        </div>
        <Pill tone="amber">가견적 · 계약가 아님</Pill>
      </header>
      <dl className="m-0 grid grid-cols-2 gap-3 rounded-xl bg-surface-card p-4 text-[14px] shadow-(--hairline-default) sm:grid-cols-4">
        <Meta label="견적 번호" value={document.quoteNo} />
        <Meta label="견적 일자" value={formatDate(document.createdAt)} />
        <Meta label="제품군" value={document.productFamily ?? '—'} />
        <Meta label="작성자" value={document.ownerName} />
      </dl>
      <div className="overflow-x-auto rounded-xl bg-surface-card shadow-(--hairline-default)">
        <table aria-label="견적 품목 표" className="w-full border-collapse text-[14px]">
          <thead className="bg-surface-muted text-left text-[12px] text-text-tertiary">
            <tr>
              <th className="py-2.5 pl-4 font-semibold">No</th>
              <th className="py-2.5 font-semibold">품목</th>
              <th className="py-2.5 font-semibold">단가유형</th>
              <th className="py-2.5 text-right font-semibold">수량</th>
              <th className="py-2.5 text-right font-semibold">단가</th>
              <th className="py-2.5 text-right font-semibold">할인</th>
              <th className="py-2.5 pr-4 text-right font-semibold">금액</th>
            </tr>
          </thead>
          <tbody>
            {document.lines.map((line) => (
              <tr key={line.lineNo} className="border-t border-border-subtle align-top">
                <td className="py-2.5 pl-4 text-text-tertiary">{line.lineNo}</td>
                <td className="py-2.5">
                  <div className="font-semibold">{line.name}</div>
                  {line.itemCode ? (
                    <div className="text-[11px] text-text-tertiary">{line.itemCode}</div>
                  ) : null}
                  {line.options.map((option, index) => (
                    <div
                      key={`${option.itemCode}-${index}`}
                      className="text-[11px] text-text-tertiary"
                    >
                      + {option.label} {option.name} ({option.itemCode})
                      {option.qty > 1 ? ` × ${option.qty}` : ''} ·{' '}
                      {priceLabel(option.unitPrice, line.currency)}
                    </div>
                  ))}
                </td>
                <td className="py-2.5 whitespace-nowrap">
                  {line.priceType ?? (line.kind === 'group' ? '그룹' : '—')}
                </td>
                <td className="py-2.5 text-right">{line.qty}</td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  {priceLabel(line.unitPrice, line.currency)}
                </td>
                <td className="py-2.5 text-right">{Number(line.discountRate)}%</td>
                <td className="py-2.5 pr-4 text-right font-semibold whitespace-nowrap">
                  {priceLabel(line.lineTotal, line.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section
        aria-label="견적 합계"
        className="flex flex-col items-end gap-1 rounded-2xl bg-surface-inverse p-6 text-text-inverse"
      >
        {document.totalAmount !== null && document.currency ? (
          <>
            <span className="text-[12px] text-text-inverse/60">합계 (할인 반영)</span>
            <strong className="text-[28px] font-bold" data-testid="share-total">
              {priceLabel(document.totalAmount, document.currency)}
            </strong>
          </>
        ) : (
          <>
            {/* 어두운 패널(surface-inverse) 위 — warning-500 이 글자 AA 이상 (warning-700 은 어두운 바탕에서 미달이라 쓰지 않는다, BL-2) */}
            <span className="text-[12px] text-warning-500">
              통화가 섞여 있어 통화별 소계로 표시합니다
            </span>
            {document.subtotals.map((subtotal) => (
              <strong key={subtotal.currency} className="text-[20px] font-bold">
                {priceLabel(subtotal.amount, subtotal.currency)}
              </strong>
            ))}
          </>
        )}
      </section>
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-text-tertiary">{label}</dt>
      <dd className="m-0 font-semibold">{value}</dd>
    </div>
  );
}
