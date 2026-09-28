'use client';

import { useEffect, useState } from 'react';

import { Drawer } from '@/components/ui';
import { priceLabel, priceTypeLabel } from '@/lib/pricing/format';
import { periodLabel } from '@/lib/pricing/period';

import { getPriceRowDetailAction } from './actions';
import { ItemStatusPill, OperationStatus } from './cells';

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

/** 행 상세 (§4.5.3): 원본 20컬럼 + source·임포트 배치 + 같은 계열 이력 타임라인 */
export function RowDetailDrawer({ rowId, onClose }: RowDetailDrawerProps) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <Drawer open={rowId !== null} onClose={onClose} title="행 상세" width={520}>
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-red-500">
          {error}
        </p>
      ) : null}
      {!current && !error ? (
        <p className="m-0 text-[13px] text-text-tertiary">불러오는 중…</p>
      ) : null}
      {current ? <DetailBody detail={current} /> : null}
    </Drawer>
  );
}

function DetailBody({ detail }: { detail: Detail }) {
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
      </section>
    </div>
  );
}
