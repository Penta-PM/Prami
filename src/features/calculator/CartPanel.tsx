'use client';

import { m } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button, Modal } from '@/components/ui';
import { DataTable, DataTableResetButton, type DataTableColumn } from '@/components/ui/data-table';
import { Presence } from '@/components/motion/Presence';
import { formatDate } from '@/lib/date-format';
import { VARIANT_KEYS, listItem, transition } from '@/lib/motion/tokens';
import { priceLabel } from '@/lib/pricing/format';
import { cartTotals } from '@/lib/pricing/quote';

import { describeLine } from './cart';
import type { CartLine, SavedQuoteView } from './types';

type CartPanelProps = {
  /** 현재 사용자 id — 견적 목록 표의 열 너비·순서 저장 키 (#32 스펙 §5) */
  userId: string;
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
          {/* 담기·삭제는 height 접힘 + fade, 나머지는 layout 재배치 (Motion 도입 스펙 §3.3 클라이언트 목록).
              Presence initial={false} 라 페이지 로드·복원 시 이미 있는 항목은 애니메이션 없이 최종 상태 */}
          <Presence>
            {lines.map((line) => (
              <m.li
                key={line.id}
                layout
                variants={listItem}
                initial={VARIANT_KEYS.initial}
                animate={VARIANT_KEYS.animate}
                exit={VARIANT_KEYS.exit}
                transition={{ layout: transition.layout }}
                // shrink-0: overflow:hidden 인 flex 아이템은 min-height 가 0 이 되어 넘치는 세로 flex 안에서 높이 0 으로
                // 줄 수 있다 (PR-3 Collapse 회귀). 테두리·패딩은 안쪽 div 에 두어 접힐 때 패딩만 남지 않게 한다
                className="shrink-0 overflow-hidden"
              >
                <div className="flex items-start justify-between gap-2 border-t border-border-subtle py-2.5">
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
                </div>
              </m.li>
            ))}
          </Presence>
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

      <Presence>
        {listOpen ? (
          <SavedQuotesModal
            userId={props.userId}
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
      </Presence>
    </div>
  );
}

function totalLabel(quote: SavedQuoteView): string {
  if (quote.totalAmount && quote.currency) return priceLabel(quote.totalAmount, quote.currency);
  return '통화 혼합';
}

/** 열 너비·순서 저장 키의 표 구분자 (#32 스펙 §5) */
const MY_QUOTES_TABLE_ID = 'my-quotes';

/**
 * 백드롭 클릭 오인 방지 (#32 스펙 §7 — 모달 안에서 정렬·드래그를 해도 닫히지 않는다).
 * 브라우저는 pointerdown 과 pointerup 대상의 공통 조상에 click 을 보낸다. 헤더를 끌다가 대화상자 밖(백드롭)에서 놓으면
 * 그 공통 조상이 <dialog> 자체라 Modal 의 "target === currentTarget → 백드롭 클릭" 판정에 걸려 닫힌다.
 * 그래서 누르기가 패널 안에서 시작된 click 은 <dialog> 에 닿기 전에 window capture 에서 멈춘다.
 * 백드롭에서 누르고 뗀 진짜 백드롭 클릭은 그대로 둔다.
 */
function useIgnoreBackdropClickFromInside() {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let pressedInside = false;
    const onPointerDown = (event: PointerEvent) => {
      // 패널(제목·닫기 버튼 포함) 안 = <dialog> 의 자손. <dialog> 자신이 대상이면 백드롭에서 누른 것
      const dialog = contentRef.current?.closest('dialog');
      const target = event.target;
      pressedInside =
        !!dialog && target instanceof Node && target !== dialog && dialog.contains(target);
    };
    const onClick = (event: MouseEvent) => {
      const dialog = contentRef.current?.closest('dialog');
      const fromInside = pressedInside;
      pressedInside = false;
      if (fromInside && dialog && event.target === dialog) event.stopPropagation();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('click', onClick, true);
    };
  }, []);
  return contentRef;
}

function SavedQuotesModal({
  userId,
  saved,
  onClose,
  onReload,
  onDelete,
  onShare,
}: {
  userId: string;
  saved: readonly SavedQuoteView[];
  onClose: () => void;
  onReload: (quote: SavedQuoteView) => void;
  onDelete: (quote: SavedQuoteView) => void;
  onShare: (quote: SavedQuoteView) => void;
}) {
  const contentRef = useIgnoreBackdropClickFromInside();

  // 부모가 넘기는 콜백은 렌더마다 새 함수라, 열 배열(저장 레이아웃 정규화 기준)을 고정하려고 최신 값을 ref 로 읽는다.
  // ref 는 클릭 핸들러 안에서만 읽는다(렌더 중 읽기 없음)
  const handlersRef = useRef({ onClose, onReload, onDelete, onShare });
  useEffect(() => {
    handlersRef.current = { onClose, onReload, onDelete, onShare };
  });

  // 열 배열은 저장 레이아웃 정규화의 기준이라 렌더마다 새로 만들지 않는다
  const columns = useMemo<DataTableColumn<SavedQuoteView>[]>(
    () => [
      {
        id: 'quoteNo',
        header: '견적 번호',
        type: 'text',
        sortValue: (quote) => quote.quoteNo,
        headerClassName: 'pl-5',
        cellClassName: 'pl-5 whitespace-nowrap text-text-tertiary',
        cell: (quote) => quote.quoteNo,
      },
      {
        id: 'createdAt',
        header: '일자',
        type: 'date',
        sortValue: (quote) => quote.createdAt,
        cellClassName: 'whitespace-nowrap text-text-tertiary',
        cell: (quote) => formatDate(quote.createdAt),
      },
      {
        id: 'productFamily',
        header: '제품',
        type: 'text',
        sortValue: (quote) => quote.productFamily,
        cellClassName: 'font-semibold whitespace-nowrap',
        cell: (quote) => quote.productFamily,
      },
      {
        id: 'summary',
        header: '내용',
        type: 'text',
        sortValue: (quote) => quote.summary,
        cellClassName: 'text-text-secondary',
        cell: (quote) => quote.summary,
      },
      {
        id: 'totalAmount',
        header: '금액',
        type: 'number',
        // 통화가 섞이면 통화로 먼저 묶고 같은 통화 안에서 금액순 (#32 스펙 §2). '통화 혼합' 견적은 빈 값 → 맨 뒤
        sortValue: (quote) =>
          quote.totalAmount && quote.currency
            ? { amount: Number(quote.totalAmount), currency: quote.currency }
            : null,
        align: 'right',
        cellClassName: 'font-semibold whitespace-nowrap',
        cell: (quote) => totalLabel(quote),
      },
      {
        id: 'actions',
        header: ' ',
        label: '관리',
        type: 'none',
        pinned: 'end',
        align: 'right',
        headerClassName: 'pr-5',
        cellClassName: 'pr-5 whitespace-nowrap',
        cell: (quote) => (
          <>
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
              onClick={() => handlersRef.current.onShare(quote)}
            >
              공유
            </button>
            <button
              type="button"
              aria-label={`${quote.quoteNo} 장바구니 담기`}
              className="mr-1.5 border-0 bg-transparent text-[12px] font-semibold text-purple-600"
              onClick={() => {
                handlersRef.current.onReload(quote);
                handlersRef.current.onClose();
              }}
            >
              장바구니 담기
            </button>
            <button
              type="button"
              aria-label={`${quote.quoteNo} 삭제`}
              className="border-0 bg-transparent text-[12px] font-semibold text-red-500"
              onClick={() => handlersRef.current.onDelete(quote)}
            >
              삭제
            </button>
          </>
        ),
      },
    ],
    [],
  );

  return (
    <Modal open onClose={onClose} title="내 견적 목록" className="w-[min(860px,calc(100vw-32px))]">
      <div ref={contentRef}>
        <div className="mb-2 flex justify-end">
          <DataTableResetButton tableId={MY_QUOTES_TABLE_ID} userId={userId} columns={columns} />
        </div>
        <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
          {/* 행에는 transform·layout 애니메이션을 걸지 않는다 (#32 스펙 §5, Motion 스펙 금지 2) */}
          <DataTable
            tableId={MY_QUOTES_TABLE_ID}
            userId={userId}
            columns={columns}
            rows={saved}
            getRowKey={(quote) => quote.id}
            aria-label="견적 목록 표"
            headClassName="bg-gray-75"
          />
          {saved.length === 0 ? (
            <p className="m-0 p-8 text-center text-[13px] text-text-tertiary">
              저장된 견적이 없습니다.
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
