'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import { OperationStatus } from '@/features/pricing/cells';
import { cn } from '@/lib/cn';
import { priceLabel } from '@/lib/pricing/format';
import { periodLabel } from '@/lib/pricing/period';

import { CostCreateModal } from './CostCreateModal';
import { CostDeleteModal } from './CostDeleteModal';
import { CostEditModal } from './CostEditModal';
import type { CostRowView } from './types';

/** 원가 표 컬럼 (디자인 원가 관리 표, §4.5.5) — 분류는 spec 이 전부 비어 있어 1차는 단위 */
export const COST_COLUMNS = [
  { key: 'code', label: '원자재 코드', align: 'left' },
  { key: 'name', label: '원자재명', align: 'left' },
  { key: 'category', label: '분류', align: 'left' },
  { key: 'cost', label: '원가', align: 'right' },
  { key: 'effectiveFrom', label: '적용시작일', align: 'left' },
  { key: 'period', label: '적용기간', align: 'center' },
  { key: 'status', label: '상태', align: 'center' },
  { key: 'actions', label: '관리', align: 'right' },
] as const;

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;
const ACTION = 'border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold hover:underline';

type Flash = { tone: 'ok' | 'error'; text: string };

/** 원가 표 + 수정/삭제 모달 (ADMIN). 원가 값은 이 화면에만 노출된다 */
export function CostBrowser({ rows }: { rows: readonly CostRowView[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CostRowView | null>(null);
  const [deleting, setDeleting] = useState<CostRowView | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  const done = (text: string) => {
    setCreating(false);
    setEditing(null);
    setDeleting(null);
    setFlash({ tone: 'ok', text });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <Presence>
        {flash ? (
          <Collapse key="flash" role={flash.tone === 'error' ? 'alert' : 'status'}>
            <p
              className={cn(
                'm-0 rounded-lg px-3.5 py-2.5 text-[13px]',
                flash.tone === 'error'
                  ? 'bg-red-500/10 text-red-500'
                  : 'bg-green-600/12 text-green-700',
              )}
            >
              {flash.text}
            </p>
          </Collapse>
        ) : null}
      </Presence>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          + 등록
        </Button>
      </div>
      <CostTable rows={rows} onEdit={setEditing} onDelete={setDeleting} />
      <Presence>
        {creating ? <CostCreateModal onClose={() => setCreating(false)} onSaved={done} /> : null}
      </Presence>
      <Presence>
        {editing ? (
          <CostEditModal row={editing} onClose={() => setEditing(null)} onSaved={done} />
        ) : null}
      </Presence>
      <Presence>
        {deleting ? (
          <CostDeleteModal row={deleting} onClose={() => setDeleting(null)} onDeleted={done} />
        ) : null}
      </Presence>
    </div>
  );
}

type CostTableProps = {
  rows: readonly CostRowView[];
  onEdit: (row: CostRowView) => void;
  onDelete: (row: CostRowView) => void;
};

function CostTable({ rows, onEdit, onDelete }: CostTableProps) {
  return (
    <div className="overflow-x-auto rounded-[10px] bg-surface-card shadow-(--hairline-default)">
      <table aria-label="원가 표" className="w-full border-collapse">
        <thead className="bg-gray-75">
          <tr>
            {COST_COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-3 py-[13px] text-[12px] font-semibold whitespace-nowrap text-text-tertiary first:pl-5 last:pr-5',
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
            <CostRow key={row.id} row={row} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <div className="p-12 text-center text-[13px] text-text-tertiary">검색 결과가 없습니다.</div>
      ) : null}
    </div>
  );
}

type CostRowProps = { row: CostRowView } & Pick<CostTableProps, 'onEdit' | 'onDelete'>;

function CostRow({ row, onEdit, onDelete }: CostRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-gray-75">
      <td className="px-3 py-3.5 pl-5 text-[12px] whitespace-nowrap text-text-tertiary">
        {row.materialCode}
      </td>
      <td className="px-3 py-3.5 text-[13px] font-semibold whitespace-nowrap text-ink-900">
        {row.materialName}
        {row.source === 'manual' ? (
          <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">수동</span>
        ) : null}
      </td>
      <td className="px-3 py-3.5 text-[13px] whitespace-nowrap text-text-secondary">{row.unit}</td>
      <td className="px-3 py-3.5 text-right text-[13px] font-semibold whitespace-nowrap text-ink-900">
        {priceLabel(row.unitCost, row.currency)}
      </td>
      <td className="px-3 py-3.5 text-[12px] whitespace-nowrap text-text-tertiary">
        {row.effectiveFrom}
      </td>
      <td className="px-3 py-3.5 text-center text-[12px] whitespace-nowrap text-text-tertiary">
        {periodLabel(row.effectiveFrom, row.effectiveTo)}
      </td>
      <td className="px-3 py-3.5 text-center whitespace-nowrap">
        <OperationStatus status={row.operationStatus} />
      </td>
      <td className="px-3 py-3.5 pr-5 text-right whitespace-nowrap">
        <button
          type="button"
          aria-label={`${row.materialName} 수정`}
          className={`${ACTION} text-purple-600`}
          onClick={() => onEdit(row)}
        >
          수정
        </button>
        <button
          type="button"
          aria-label={`${row.materialName} 삭제`}
          className={`${ACTION} text-red-500`}
          onClick={() => onDelete(row)}
        >
          삭제
        </button>
      </td>
    </tr>
  );
}
