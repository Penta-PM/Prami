'use client';

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui';

import type { PartMappingView } from './types';

type PartsMappingTableProps = {
  mappings: readonly PartMappingView[];
  onEdit: (mapping: PartMappingView) => void;
  onDelete: (mapping: PartMappingView) => void;
};

const ACTION = 'border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold hover:underline';

/** "등록된 매핑" 표 — 모델별 1행, 파츠는 품명(품번) 목록 (§4.3.6 GROUP BY, R-02, AC-30) */
export function PartsMappingTable({ mappings, onEdit, onDelete }: PartsMappingTableProps) {
  return (
    <section aria-labelledby="parts-mappings" className="flex flex-col gap-3">
      <h2 id="parts-mappings" className="m-0 text-[13px] font-semibold text-text-tertiary">
        등록된 매핑
      </h2>
      <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
        <Table aria-label="등록된 매핑 표">
          <TableHead className="bg-gray-75">
            <TableRow>
              <TableHeaderCell className="pl-5 whitespace-nowrap">모델</TableHeaderCell>
              <TableHeaderCell>장착 가능 파츠 (품번)</TableHeaderCell>
              <TableHeaderCell className="pr-5 text-right whitespace-nowrap">관리</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {mappings.map((mapping) => (
              <TableRow key={mapping.modelItemCode}>
                <TableCell className="pl-5 font-semibold whitespace-nowrap">
                  {mapping.modelName}
                  <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">
                    {mapping.modelItemCode}
                  </span>
                </TableCell>
                <TableCell className="text-[12px] text-text-secondary">
                  {mapping.parts.map((part) => `${part.itemName} (${part.itemCode})`).join(', ')}
                </TableCell>
                <TableCell className="pr-5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    aria-label={`${mapping.modelName} 매핑 수정`}
                    className={`${ACTION} text-purple-600`}
                    onClick={() => onEdit(mapping)}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    aria-label={`${mapping.modelName} 매핑 삭제`}
                    className={`${ACTION} text-red-500`}
                    onClick={() => onDelete(mapping)}
                  >
                    삭제
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {mappings.length === 0 ? (
          <p className="m-0 p-8 text-center text-[13px] text-text-tertiary">
            등록된 매핑이 없습니다.
          </p>
        ) : null}
      </div>
    </section>
  );
}
