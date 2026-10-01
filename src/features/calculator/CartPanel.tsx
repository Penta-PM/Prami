'use client';

import { useState } from 'react';

import {
  Button,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui';
import { formatAuditTime } from '@/lib/audit-format';
import { priceLabel } from '@/lib/pricing/format';
import { cartTotals } from '@/lib/pricing/quote';

import { describeLine } from './cart';
import type { CartLine, SavedQuoteView } from './types';

type CartPanelProps = {
  lines: readonly CartLine[];
  saved: readonly SavedQuoteView[];
  isPending: boolean;
  onRemove: (id: string) => void;
  onReset: () => void;
  onSave: () => void;
  onReload: (quote: SavedQuoteView) => void;
  onDelete: (quote: SavedQuoteView) => void;
  /** 출력·공유 대상 = 방금 저장했거나 담기로 불러온 견적 (없으면 버튼 비활성) */
  activeQuote: SavedQuoteView | null;
  onShare: (quote: SavedQuoteView) => void;
};

/** 견적서 PDF Route (§4.5.8) — 소유자·ADMIN 만 200, 타인 403 */
export function quotePdfHref(quote: Pick<SavedQuoteView, 'id'>): string {
  return `/api/quotes/${quote.id}/pdf`;
}

/** 우측 고정 패널: 장바구니 · 내 견적 목록(미리보기 + 전체보기 모달) · 예상 견적 금액 카드 · 출력/공유 */
export function CartPanel(props: CartPanelProps) {
  const { lines, saved, isPending, activeQuote } = props;
  const [listOpen, setListOpen] = useState(false);
  const totals = cartTotals(
    lines.map((line) => ({ currency: line.currency, lineTotal: line.lineTotal })),
  );

  return (
    <div className="sticky top-4 flex flex-col gap-4">
      <section
        aria-label="장바구니"
        className="max-h-[300px] overflow-y-auto rounded-xl bg-surface-card p-5 shadow-(--hairline-default)"
      >
        <h2 className="m-0 mb-3 text-[13px] font-semibold">장바구니 ({lines.length})</h2>
        <ul className="m-0 flex list-none flex-col p-0">
          {lines.map((line) => (
            <li
              key={line.id}
              className="flex items-start justify-between gap-2 border-t border-border-subtle py-2.5"
            >
              <div className="min-w-0">
                <div className="text-[12px] font-semibold">{line.name}</div>
                <div className="text-[11px] text-text-tertiary">{describeLine(line)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[12px] font-semibold">
                  {priceLabel(line.lineTotal, line.currency)}
                </span>
                <button
                  type="button"
                  aria-label={`${line.name} 삭제`}
                  className="border-0 bg-transparent text-[14px] font-semibold text-red-500"
                  onClick={() => props.onRemove(line.id)}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
          {lines.length === 0 ? (
            <li className="py-4 text-center text-[12px] text-text-tertiary">
              담긴 품목이 없습니다.
            </li>
          ) : null}
        </ul>
      </section>

      <section
        aria-label="내 견적 목록"
        className="rounded-xl bg-surface-card p-5 shadow-(--hairline-default)"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-[13px] font-semibold">내 견적 목록 ({saved.length})</h2>
          <button
            type="button"
            className="border-0 bg-transparent text-[11px] font-semibold text-purple-600"
            onClick={() => setListOpen(true)}
          >
            전체보기
          </button>
        </div>
        <ul className="m-0 flex max-h-[180px] list-none flex-col overflow-y-auto p-0">
          {saved.slice(0, 5).map((quote) => (
            <li
              key={quote.id}
              className="flex items-start justify-between gap-2 border-t border-border-subtle py-2.5"
            >
              <div className="min-w-0">
                <div className="text-[12px] font-semibold">
                  {quote.quoteNo} · {quote.productFamily}
                </div>
                <div className="truncate text-[11px] text-text-tertiary">{quote.summary}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[12px] font-semibold">{totalLabel(quote)}</span>
                <button
                  type="button"
                  aria-label={`${quote.quoteNo} 담기`}
                  className="border-0 bg-transparent text-[11px] font-semibold text-purple-600"
                  onClick={() => props.onReload(quote)}
                >
                  담기
                </button>
              </div>
            </li>
          ))}
          {saved.length === 0 ? (
            <li className="py-4 text-center text-[12px] text-text-tertiary">
              저장된 견적이 없습니다.
            </li>
          ) : null}
        </ul>
      </section>

      <section
        aria-label="예상 견적 금액"
        className="flex flex-col gap-4 rounded-2xl bg-ink-900 p-7 text-white"
      >
        <span className="text-[13px] font-semibold text-lime-500">예상 견적 금액</span>
        {totals.total !== null && totals.currency ? (
          <strong className="text-[34px] font-bold" data-testid="quote-total">
            {priceLabel(totals.total, totals.currency)}
          </strong>
        ) : totals.count === 0 ? (
          <strong className="text-[34px] font-bold" data-testid="quote-total">
            0원
          </strong>
        ) : (
          <div role="note" aria-label="통화별 소계" className="flex flex-col gap-1">
            <span className="text-[12px] text-amber-500">
              통화가 섞여 있어 단일 합계 대신 통화별 소계를 표시합니다
            </span>
            {totals.subtotals.map((subtotal) => (
              <strong key={subtotal.currency} className="text-[22px] font-bold">
                {priceLabel(subtotal.amount, subtotal.currency)}
              </strong>
            ))}
          </div>
        )}
        <dl className="m-0 flex flex-col gap-2.5 border-t border-white/12 pt-4 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-white/60">품목 수</dt>
            <dd className="m-0">{totals.count}개</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-white/60">합계 (할인 반영)</dt>
            <dd className="m-0">
              {totals.subtotals
                .map((subtotal) => priceLabel(subtotal.amount, subtotal.currency))
                .join(' / ') || '0원'}
            </dd>
          </div>
        </dl>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            className="flex-1 border border-white/20 bg-transparent text-white hover:bg-white/10"
            onClick={props.onReset}
          >
            견적 초기화
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={lines.length === 0 || isPending}
            onClick={props.onSave}
          >
            견적 저장
          </Button>
        </div>
        <p className="m-0 text-[11px] text-white/60" data-testid="active-quote">
          {activeQuote
            ? `출력·공유 대상: ${activeQuote.quoteNo}`
            : '견적을 저장하거나 목록에서 담으면 출력·공유할 수 있습니다'}
        </p>
        <div className="flex gap-2">
          {activeQuote ? (
            <a
              className="inline-flex flex-1 items-center justify-center rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-white/10"
              href={quotePdfHref(activeQuote)}
              target="_blank"
              rel="noreferrer"
              aria-label={`${activeQuote.quoteNo} 견적서 출력`}
            >
              견적서 출력
            </a>
          ) : (
            <Button
              className="flex-1 border border-white/20 bg-transparent text-white/50"
              disabled
              title="견적을 먼저 저장하세요"
            >
              견적서 출력
            </Button>
          )}
          <Button
            className="flex-1 border border-white/20 bg-transparent text-white disabled:text-white/50"
            disabled={!activeQuote}
            title={activeQuote ? undefined : '견적을 먼저 저장하세요'}
            aria-label={activeQuote ? `${activeQuote.quoteNo} 견적 공유` : '견적 공유'}
            onClick={() => activeQuote && props.onShare(activeQuote)}
          >
            견적 공유
          </Button>
        </div>
      </section>

      {listOpen ? (
        <SavedQuotesModal
          saved={saved}
          onClose={() => setListOpen(false)}
          onReload={props.onReload}
          onDelete={props.onDelete}
          onShare={(quote) => {
            setListOpen(false);
            props.onShare(quote);
          }}
        />
      ) : null}
    </div>
  );
}

function totalLabel(quote: SavedQuoteView): string {
  if (quote.totalAmount && quote.currency) return priceLabel(quote.totalAmount, quote.currency);
  return '통화 혼합';
}

function SavedQuotesModal({
  saved,
  onClose,
  onReload,
  onDelete,
  onShare,
}: {
  saved: readonly SavedQuoteView[];
  onClose: () => void;
  onReload: (quote: SavedQuoteView) => void;
  onDelete: (quote: SavedQuoteView) => void;
  onShare: (quote: SavedQuoteView) => void;
}) {
  return (
    <Modal open onClose={onClose} title="내 견적 목록" className="w-[min(860px,calc(100vw-32px))]">
      <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
        <Table aria-label="견적 목록 표">
          <TableHead className="bg-gray-75">
            <TableRow>
              <TableHeaderCell className="pl-5">견적 번호</TableHeaderCell>
              <TableHeaderCell>일자</TableHeaderCell>
              <TableHeaderCell>제품</TableHeaderCell>
              <TableHeaderCell>내용</TableHeaderCell>
              <TableHeaderCell className="text-right">금액</TableHeaderCell>
              <TableHeaderCell className="pr-5 text-right"> </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {saved.map((quote) => (
              <TableRow key={quote.id}>
                <TableCell className="pl-5 whitespace-nowrap text-text-tertiary">
                  {quote.quoteNo}
                </TableCell>
                <TableCell className="whitespace-nowrap text-text-tertiary">
                  {formatAuditTime(new Date(quote.createdAt)).slice(0, 10)}
                </TableCell>
                <TableCell className="font-semibold whitespace-nowrap">
                  {quote.productFamily}
                </TableCell>
                <TableCell className="text-text-secondary">{quote.summary}</TableCell>
                <TableCell className="text-right font-semibold whitespace-nowrap">
                  {totalLabel(quote)}
                </TableCell>
                <TableCell className="pr-5 text-right whitespace-nowrap">
                  <a
                    className="mr-1.5 text-[12px] font-semibold text-purple-600"
                    href={quotePdfHref(quote)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${quote.quoteNo} PDF`}
                  >
                    PDF
                  </a>
                  <button
                    type="button"
                    aria-label={`${quote.quoteNo} 공유`}
                    className="mr-1.5 border-0 bg-transparent text-[12px] font-semibold text-purple-600"
                    onClick={() => onShare(quote)}
                  >
                    공유
                  </button>
                  <button
                    type="button"
                    aria-label={`${quote.quoteNo} 장바구니 담기`}
                    className="mr-1.5 border-0 bg-transparent text-[12px] font-semibold text-purple-600"
                    onClick={() => {
                      onReload(quote);
                      onClose();
                    }}
                  >
                    장바구니 담기
                  </button>
                  <button
                    type="button"
                    aria-label={`${quote.quoteNo} 삭제`}
                    className="border-0 bg-transparent text-[12px] font-semibold text-red-500"
                    onClick={() => onDelete(quote)}
                  >
                    삭제
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {saved.length === 0 ? (
          <p className="m-0 p-8 text-center text-[13px] text-text-tertiary">
            저장된 견적이 없습니다.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
