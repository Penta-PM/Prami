'use client';

import { useEffect, useState } from 'react';

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
import { changeAmountLabel, priceLabel, priceTypeLabel } from '@/lib/pricing/format';
import { periodLabel } from '@/lib/pricing/period';

import { getPriceHistoryAction } from './actions';
import { OperationStatus, PriceChange } from './cells';

type History = Extract<Awaited<ReturnType<typeof getPriceHistoryAction>>, { ok: true }>['data'];
type HistoryRow = History['rows'][number];

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; history: History }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export const PRICE_HISTORY_NOT_FOUND = '삭제되었거나 찾을 수 없는 가격입니다.';
export const PRICE_HISTORY_FIRST_ONLY = '이 계열의 첫 가격입니다. 이전 변동 이력이 없습니다.';

/** 거래처코드 '0' = 전체 고객 (§4.3.1) */
function customerLabel(code: string, name: string | null): string {
  if (code === '0') return '전체 고객';
  return name ? `${code} (${name})` : code;
}

function sourceLabel(row: Pick<HistoryRow, 'source' | 'batchFileName'>): string {
  if (row.source !== 'erp') return '수동 등록';
  return row.batchFileName ? `ERP 임포트 (${row.batchFileName})` : 'ERP 임포트';
}

type PriceHistoryModalProps = {
  /** 클릭한(또는 드로어의) 가격 행 id — 서버는 이 id 로 계열을 찾는다(series_key 를 보내지 않는다) */
  rowId: number;
  onClose: () => void;
};

/**
 * 가격 변동 이력 모달 (price-change-history-modal §2.3): 같은 계열의 삭제되지 않은 행 전부, 적용시작일 최신 순.
 * 열릴 때 1회 요청(다시 시도 = 재요청), 늦게 온 이전 응답은 무시한다. 원가 비중·변경자는 싣지 않는다.
 * 닫기(Esc·닫기·백드롭)와 포커스 복귀(연 버튼)는 공용 Modal 규칙.
 */
export function PriceHistoryModal({ rowId, onClose }: PriceHistoryModalProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getPriceHistoryAction(rowId).then(
      (result) => {
        if (cancelled) return;
        if (result.ok) setState({ kind: 'ready', history: result.data });
        else if (result.error.code === 'NOT_FOUND') setState({ kind: 'not-found' });
        else setState({ kind: 'error', message: result.error.message });
      },
      () => {
        if (!cancelled)
          setState({ kind: 'error', message: '이력을 불러오지 못했습니다. 다시 시도하세요.' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rowId, attempt]);

  const retry = () => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  };

  return (
    <Modal open onClose={onClose} title="가격 변동 이력" size="lg">
      {state.kind === 'loading' ? (
        <p role="status" className="m-0 text-[14px] text-text-tertiary">
          불러오는 중…
        </p>
      ) : state.kind === 'not-found' ? (
        <p className="m-0 text-[14px] text-text-secondary">{PRICE_HISTORY_NOT_FOUND}</p>
      ) : state.kind === 'error' ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 text-[14px] text-text-danger"
        >
          <span>{state.message}</span>
          <Button onClick={retry}>다시 시도</Button>
        </div>
      ) : (
        <HistoryBody history={state.history} currentId={rowId} />
      )}
    </Modal>
  );
}

function HistoryBody({ history, currentId }: { history: History; currentId: number }) {
  const { series, rows } = history;
  const summary: [string, string][] = [
    ['품명', series.itemName],
    ['품번', series.itemCode],
    ['단가유형', priceTypeLabel(series.priceType)],
    ['단가구분', series.priceCategory],
    ['화폐', series.currency],
    ['거래처', customerLabel(series.customerCode, series.customerName)],
  ];
  // 품목 마스터 비고는 서버가 ADMIN 응답의 요약에만 싣는다(§6 A) — 계열 안 모든 행이 같은 값이라 한 번만, 비어 있으면 숨김
  const erpRemark = series.erpRemark?.trim();
  if (erpRemark) summary.push(['ERP 비고(품목)', erpRemark]);
  return (
    <div className="flex min-w-0 flex-col gap-4 text-[14px]">
      <dl
        aria-label="계열 요약"
        className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr_auto_1fr]"
      >
        {summary.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-text-tertiary">{label}</dt>
            <dd className="m-0 min-w-0 break-all text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-[10px] shadow-(--hairline-default)">
        <Table aria-label="가격 변동 이력 표">
          <TableHead className="bg-surface-muted">
            <TableRow>
              <TableHeaderCell>적용기간</TableHeaderCell>
              <TableHeaderCell className="text-right">판매가</TableHeaderCell>
              <TableHeaderCell className="text-right">직전 대비 금액</TableHeaderCell>
              <TableHeaderCell>변동률</TableHeaderCell>
              <TableHeaderCell>운영상태</TableHeaderCell>
              <TableHeaderCell>출처</TableHeaderCell>
              <TableHeaderCell>비고</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-row-id={row.id}
                aria-current={row.id === currentId ? 'true' : undefined}
                className="text-[12px] aria-[current]:bg-primary-50"
              >
                <TableCell className="whitespace-nowrap text-text-secondary">
                  {periodLabel(row.effectiveFrom, row.effectiveTo)}
                </TableCell>
                <TableCell className="text-right font-semibold whitespace-nowrap">
                  {priceLabel(row.unitPrice, series.currency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap text-text-secondary tabular-nums">
                  {changeAmountLabel(row.changeAmount, series.currency)}
                </TableCell>
                <TableCell>
                  <PriceChange
                    unitPrice={row.unitPrice}
                    previousPrice={row.previousPrice}
                    rate={row.changeRate}
                  />
                </TableCell>
                <TableCell>
                  <OperationStatus status={row.operationStatus} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-text-secondary">
                  {sourceLabel(row)}
                </TableCell>
                {/* 행별 판매단가 비고 — 가격 표 '비고' 칸과 같은 값·표기(없으면 빈 칸) */}
                <TableCell className="min-w-[160px] text-text-tertiary">
                  {row.remark ?? ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length === 1 ? (
        <p className="m-0 text-[12px] text-text-tertiary">{PRICE_HISTORY_FIRST_ONLY}</p>
      ) : null}
    </div>
  );
}
