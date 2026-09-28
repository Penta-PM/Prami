'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { priceLabel, priceTypeLabel } from '@/lib/pricing/format';
import { operationYearsLabel, periodLabel } from '@/lib/pricing/period';

import { ItemStatusPill, OperationStatus } from './cells';
import { columnsFor, type PriceColumn, type PriceColumnKey, type TableMode } from './columns';
import type { PriceRowView } from './types';

type PriceTableProps = {
  mode: TableMode;
  rows: readonly PriceRowView[];
  onRowClick: (row: PriceRowView) => void;
  /** 관리 표의 `관리` 칸 (수정·복사·삭제) */
  renderActions?: (row: PriceRowView) => ReactNode;
};

const ALIGN: Record<PriceColumn['align'], string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

function cellContent(key: PriceColumnKey, row: PriceRowView, actions?: ReactNode): ReactNode {
  switch (key) {
    case 'priceType':
      return priceTypeLabel(row.priceType);
    case 'major':
      return row.major;
    case 'mid':
      return row.mid ?? '—';
    case 'minor':
      return row.minor ?? '—';
    case 'itemName':
      return (
        <span title={row.itemCode}>
          {row.itemName}
          <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">{row.itemCode}</span>
        </span>
      );
    case 'price':
      return priceLabel(row.unitPrice, row.currency);
    case 'effectiveFrom':
      return row.effectiveFrom;
    case 'period':
      return periodLabel(row.effectiveFrom, row.effectiveTo);
    case 'operationYears':
      return operationYearsLabel(row.effectiveFrom, row.effectiveTo);
    case 'itemStatus':
      return <ItemStatusPill status={row.itemStatus} />;
    case 'status':
      return <OperationStatus status={row.operationStatus} />;
    case 'remark':
      return row.remark ?? '';
    case 'actions':
      return actions;
  }
}

const EMPHASIS: Partial<Record<PriceColumnKey, string>> = {
  itemName: 'font-semibold text-ink-900 text-[13px]',
  price: 'font-semibold text-ink-900 text-[13px]',
  period: 'text-text-tertiary',
  effectiveFrom: 'text-text-tertiary',
  operationYears: 'text-text-tertiary',
  remark: 'text-text-tertiary whitespace-normal',
};

/** 가격정책 표 (디자인 조회·관리 표). 행 클릭 → 행 상세 드로어 */
export function PriceTable({ mode, rows, onRowClick, renderActions }: PriceTableProps) {
  const columns = columnsFor(mode);
  return (
    <div className="overflow-x-auto rounded-[10px] bg-surface-card shadow-(--hairline-default)">
      <table
        aria-label={mode === 'admin' ? '가격정책 관리 표' : '가격정책 표'}
        className="w-full border-collapse"
      >
        <thead className="bg-gray-75">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-3 py-[13px] text-[12px] font-semibold whitespace-nowrap text-text-tertiary first:pl-4 last:pr-4',
                  ALIGN[column.align],
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick(row)}
              className="cursor-pointer border-t border-border-subtle hover:bg-gray-75"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-3 py-3.5 text-[12px] whitespace-nowrap text-text-secondary first:pl-4 last:pr-4',
                    ALIGN[column.align],
                    EMPHASIS[column.key],
                  )}
                  onClick={
                    column.key === 'actions' ? (event) => event.stopPropagation() : undefined
                  }
                >
                  {cellContent(column.key, row, renderActions?.(row))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <div className="p-12 text-center text-[13px] text-text-tertiary">검색 결과가 없습니다.</div>
      ) : null}
    </div>
  );
}
