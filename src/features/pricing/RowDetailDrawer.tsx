'use client';

import { useEffect, useState } from 'react';

import { Presence } from '@/components/motion/Presence';
import { Button, Drawer } from '@/components/ui';
import { priceLabel, priceTypeLabel } from '@/lib/pricing/format';
import { periodLabel } from '@/lib/pricing/period';

import { getPriceRowDetailAction } from './actions';
import { ItemStatusPill, OperationStatus } from './cells';
import { PriceHistoryModal } from './PriceHistoryModal';

type Detail = Extract<Awaited<ReturnType<typeof getPriceRowDetailAction>>, { ok: true }>['data'];

/** 원본 20컬럼 (엑셀 헤더 순서, §4.3.1) — 표에 없는 원본 값의 접근 경로(R-A) */
const SOURCE_FIELDS: readonly [keyof Detail['row'], string][] = [
  ['sourceId', 'id'],
  ['productFamily', '제품군'],
  ['itemCode', '품번'],
  ['itemName', '품명'],
  ['spec', '규격'],
  ['unit', '단위'],
  ['priceType', '단가유형'],
  ['priceCategory', '단가구분'],
  ['currency', '화폐'],
  ['hasCorePrice', '코어단가유무'],
  ['unitPrice', '단가'],
  ['remark', '비고'],
  ['effectiveFrom', '적용시작일'],
  ['appliesToAllCustomers', '전체고객적용여부'],
  ['isFinalSource', '최종여부(원본)'],
  ['baseCoreCount', '기준코어수'],
  ['unitPricePerCore', '단가(1코어)'],
  ['customerCode', '거래처코드'],
  ['customerNo', '고객 번호'],
  ['customerName', '고객명'],
];

function show(key: keyof Detail['row'], value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean')
    return key === 'hasCorePrice' ? (value ? 'Y' : 'N') : value ? 'TRUE' : 'FALSE';
  return String(value);
}

type RowDetailDrawerProps = { rowId: number | null; onClose: () => void };

/**
 * 행 상세 (§4.5.3): 원본 20컬럼 + source·임포트 배치 + 같은 계열 이력 타임라인.
 * 계열 이력 끝의 "변동 이력 보기" → 가격 변동 이력 모달(드로어 행 기준, price-change-history-modal §2.4 Q-H1 = B).
 * 모달은 드로어 **밖**(형제)에 둔다 — 드로어 패널의 Esc 처리(onKeyDown)로 번지지 않아 모달 Esc 는 모달만 닫고 드로어는 남는다.
 */
export function RowDetailDrawer({ rowId, onClose }: RowDetailDrawerProps) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 어느 행에서 연 모달인지 — 드로어가 다른 행으로 바뀌거나 닫히면 지운다(같은 행을 다시 열어도 모달이 되살아나지 않게)
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [historyRow, setHistoryRow] = useState(rowId);
  if (historyRow !== rowId) {
    setHistoryRow(rowId);
    setHistoryFor(null);
  }
  const historyId = historyFor !== null && historyFor === rowId ? historyFor : null;

  useEffect(() => {
    if (rowId === null) return;
    let cancelled = false;
    void getPriceRowDetailAction(rowId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDetail(result.data);
        setError(null);
      } else {
        setDetail(null);
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [rowId]);

  const current = detail && detail.row.id === rowId ? detail : null;

  return (
    <>
      <Drawer open={rowId !== null} onClose={onClose} title="행 상세" width={520}>
        {error ? (
          <p role="alert" className="m-0 text-[13px] text-red-500">
            {error}
          </p>
        ) : null}
        {!current && !error ? (
          <p className="m-0 text-[13px] text-text-tertiary">불러오는 중…</p>
        ) : null}
        {current ? (
          <DetailBody detail={current} onShowHistory={() => setHistoryFor(current.row.id)} />
        ) : null}
      </Drawer>
      <Presence>
        {historyId !== null ? (
          <PriceHistoryModal
            key={historyId}
            rowId={historyId}
            onClose={() => setHistoryFor(null)}
          />
        ) : null}
      </Presence>
    </>
  );
}

function DetailBody({ detail, onShowHistory }: { detail: Detail; onShowHistory: () => void }) {
  const { row, history } = detail;
  return (
    <div className="flex flex-col gap-5 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <ItemStatusPill status={row.itemStatus} />
        <OperationStatus status={row.operationStatus} />
        <span className="text-text-tertiary">
          {periodLabel(row.effectiveFrom, row.effectiveTo)} ·{' '}
          {row.source === 'erp' ? 'ERP 임포트' : '수동 등록'}
          {row.batchFileName ? ` (${row.batchFileName})` : ''}
        </span>
      </div>
      {row.erpMajor || row.erpRemark ? (
        <dl aria-label="ERP 품목 정보" className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5">
          {row.erpMajor ? (
            <>
              <dt className="text-text-tertiary">ERP 대분류</dt>
              <dd className="m-0 text-ink-900">{row.erpMajor}</dd>
            </>
          ) : null}
          {row.erpRemark ? (
            <>
              <dt className="text-text-tertiary">ERP 비고</dt>
              <dd className="m-0 break-all text-ink-900">{row.erpRemark}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <section aria-label="원본 20컬럼">
        <h3 className="m-0 mb-2 text-[12px] font-semibold text-text-tertiary">원본 20컬럼</h3>
        <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5">
          {SOURCE_FIELDS.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-text-tertiary">{label}</dt>
              <dd className="m-0 break-all text-ink-900">{show(key, row[key])}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label="계열 이력">
        <h3 className="m-0 mb-2 text-[12px] font-semibold text-text-tertiary">
          계열 이력 ({priceTypeLabel(row.priceType)} · {row.priceCategory} · {row.currency} · 거래처{' '}
          {row.customerCode})
        </h3>
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {history.map((entry) => (
            <li
              key={entry.id}
              aria-current={entry.id === row.id ? 'true' : undefined}
              className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 aria-[current]:bg-lime-500/25"
            >
              <span className="text-text-secondary">
                {periodLabel(entry.effectiveFrom, entry.effectiveTo)}
              </span>
              <span className="font-semibold">{priceLabel(entry.unitPrice, entry.currency)}</span>
              <OperationStatus status={entry.operationStatus} />
            </li>
          ))}
        </ol>
        <Button
          size="sm"
          className="mt-2"
          aria-haspopup="dialog"
          onClick={(event) => {
            // 클릭으로 포커스를 주지 않는 브라우저에서도 모달이 닫히면 이 버튼으로 돌아오게 한다
            event.currentTarget.focus();
            onShowHistory();
          }}
        >
          변동 이력 보기
        </Button>
      </section>
    </div>
  );
}
