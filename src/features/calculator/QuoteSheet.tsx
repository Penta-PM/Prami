import { Pill } from '@/components/ui';
import { formatDate } from '@/lib/date-format';
import { coreLineLabel, priceLabel } from '@/lib/pricing/format';

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
      {/* 768px 이상은 7열 표, max-md 는 같은 lines 로 그린 카드 (모바일 UI 스펙 §9 MOB-DS-101 — CSS 로만 전환) */}
      <div className="overflow-x-auto rounded-xl bg-surface-card shadow-(--hairline-default) max-md:hidden">
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
                  {line.core ? (
                    <div className="text-[11px] text-text-tertiary" data-testid="core-line">
                      {coreLineLabel(line.core, line.currency)}
                    </div>
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
      <ul aria-label="견적 품목" className="m-0 flex list-none flex-col gap-2 p-0 md:hidden">
        {document.lines.map((line) => (
          <li
            key={line.lineNo}
            data-testid="quote-line-card"
            className="flex flex-col gap-1 rounded-xl bg-surface-card p-4 shadow-(--hairline-default)"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[16px] font-semibold break-words">{line.name}</div>
                <div className="text-[12px] text-text-tertiary">
                  {line.lineNo} · {line.priceType ?? (line.kind === 'group' ? '그룹' : '—')}
                  {line.itemCode ? ` · ${line.itemCode}` : ''}
                </div>
              </div>
              <strong className="shrink-0 text-[16px] font-semibold whitespace-nowrap tabular-nums">
                {priceLabel(line.lineTotal, line.currency)}
              </strong>
            </div>
            <div className="text-[14px] text-text-secondary tabular-nums">
              {line.qty} × {priceLabel(line.unitPrice, line.currency)} · 할인{' '}
              {Number(line.discountRate)}%
            </div>
            {line.core ? (
              <div className="text-[12px] text-text-tertiary" data-testid="core-line">
                {coreLineLabel(line.core, line.currency)}
              </div>
            ) : null}
            {line.options.map((option, index) => (
              <div key={`${option.itemCode}-${index}`} className="text-[12px] text-text-tertiary">
                + {option.label} {option.name} ({option.itemCode})
                {option.qty > 1 ? ` × ${option.qty}` : ''} ·{' '}
                {priceLabel(option.unitPrice, line.currency)}
              </div>
            ))}
          </li>
        ))}
      </ul>
      <section
        aria-label="견적 합계"
        className={
          // max-md: 스크롤해도 화면 아래에 붙는 합계 (MOB-DS-102 — 같은 요소 하나를 sticky 로, 하단 safe-area). 데스크톱 그대로
          'flex flex-col items-end gap-1 rounded-2xl bg-surface-inverse p-6 text-text-inverse max-md:sticky max-md:bottom-0 max-md:z-10 max-md:px-4 max-md:pt-3 max-md:pb-[calc(0.75rem+var(--safe-bottom))] max-md:shadow-modal'
        }
      >
        {document.totalAmount !== null && document.currency ? (
          <>
            <span className="text-[12px] text-text-inverse/60">합계 (할인 반영)</span>
            <strong
              className="text-[28px] font-bold tabular-nums max-md:text-[22px]"
              data-testid="share-total"
            >
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
              <strong key={subtotal.currency} className="text-[20px] font-bold tabular-nums">
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
      <dt className="text-[11px] text-text-tertiary max-md:text-[12px]">{label}</dt>
      <dd className="m-0 font-semibold">{value}</dd>
    </div>
  );
}
