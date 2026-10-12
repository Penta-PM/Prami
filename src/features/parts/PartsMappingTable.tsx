'use client';

import { useMemo } from 'react';

import { DataTable, DataTableResetButton, type DataTableColumn } from '@/components/ui/data-table';

import type { PartMappingView } from './types';

type PartsMappingTableProps = {
  mappings: readonly PartMappingView[];
  onEdit: (mapping: PartMappingView) => void;
  onDelete: (mapping: PartMappingView) => void;
  /** 열 너비·순서 저장 키를 계정별로 나눈다 (#32 스펙 §5) */
  userId: string;
};

const ACTION = 'border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold hover:underline';

/** 열 너비·순서 저장 키의 표 구분자 (#32 스펙 §5) */
const PARTS_MAPPING_TABLE_ID = 'parts-mapping';

/** "등록된 매핑" 표 — 모델별 1행, 파츠는 품명(품번) 목록 (§4.3.6 GROUP BY, R-02, AC-30) */
export function PartsMappingTable({ mappings, onEdit, onDelete, userId }: PartsMappingTableProps) {
  // 열 배열은 저장 레이아웃 정규화의 기준이라 렌더마다 새로 만들지 않는다
  const columns = useMemo<DataTableColumn<PartMappingView>[]>(
    () => [
      {
        id: 'model',
        header: '모델',
        type: 'text',
        sortValue: (mapping) => mapping.modelName,
        headerClassName: 'pl-5',
        cellClassName: 'pl-5 font-semibold whitespace-nowrap',
        cell: (mapping) => (
          <>
            {mapping.modelName}
            <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">
              {mapping.modelItemCode}
            </span>
          </>
        ),
      },
      {
        // 목록 열 — 정렬하지 않는다(스펙 §2). 너비 조절·이동은 가능
        id: 'parts',
        header: '장착 가능 파츠 (품번)',
        type: 'text',
        sortable: false,
        cellClassName: 'text-[12px] text-text-secondary',
        cell: (mapping) =>
          mapping.parts.map((part) => `${part.itemName} (${part.itemCode})`).join(', '),
      },
      {
        id: 'actions',
        header: '관리',
        type: 'none',
        pinned: 'end',
        align: 'right',
        headerClassName: 'pr-5',
        cellClassName: 'pr-5 whitespace-nowrap',
        cell: (mapping) => (
          <>
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
          </>
        ),
      },
    ],
    [onEdit, onDelete],
  );

  return (
    <section aria-labelledby="parts-mappings" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="parts-mappings" className="m-0 text-[13px] font-semibold text-text-tertiary">
          등록된 매핑
        </h2>
        <DataTableResetButton tableId={PARTS_MAPPING_TABLE_ID} userId={userId} columns={columns} />
      </div>
      <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
        <DataTable
          tableId={PARTS_MAPPING_TABLE_ID}
          userId={userId}
          columns={columns}
          rows={mappings}
          getRowKey={(mapping) => mapping.modelItemCode}
          aria-label="등록된 매핑 표"
          headClassName="bg-gray-75"
        />
        {mappings.length === 0 ? (
          <p className="m-0 p-8 text-center text-[13px] text-text-tertiary">
            등록된 매핑이 없습니다.
          </p>
        ) : null}
      </div>
    </section>
  );
}
