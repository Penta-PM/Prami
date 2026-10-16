'use client';

import { useMemo, useState } from 'react';

import {
  DataTable,
  DataTableFilterBar,
  DataTableFilterEmpty,
  DataTableResetButton,
  filterDefsOf,
  filterFieldsOf,
  useUrlFilters,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/data-table';

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
  // 정렬은 컴포넌트 상태(#32 §5), '필터 초기화' 가 함께 해제하도록 제어형으로 둔다 (열 필터 스펙 §2.5-4)
  const [sort, setSort] = useState<DataTableSort>(null);
  // 열 배열은 저장 레이아웃 정규화의 기준이라 렌더마다 새로 만들지 않는다
  const columns = useMemo<DataTableColumn<PartMappingView>[]>(
    () => [
      {
        id: 'model',
        header: '모델',
        type: 'text',
        sortValue: (mapping) => mapping.modelName,
        // 셀에 모델명과 품번이 함께 보이므로 둘 중 하나라도 맞으면 통과
        filter: { kind: 'text' },
        filterValue: (mapping) => [mapping.modelName, mapping.modelItemCode],
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
        // 목록 열 — 정렬·필터하지 않는다(#32 스펙 §2, 열 필터 스펙 §2.1-2). 너비 조절·이동은 가능
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

  const filterFields = useMemo(() => filterFieldsOf(columns), [columns]);
  const filterDefs = useMemo(() => filterDefsOf(filterFields), [filterFields]);
  // URL 의 `?family` 제품군 탭은 그대로 두고 f.* 만 바꾼다. '필터 초기화' 도 탭은 유지(탭은 화면 이동이지 필터가 아님)
  const { filters, setFilters } = useUrlFilters(filterDefs);
  const resetFilters = () => {
    setFilters([]);
    setSort(null);
  };

  return (
    <section aria-labelledby="parts-mappings" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="parts-mappings" className="m-0 text-[13px] font-semibold text-text-tertiary">
          등록된 매핑
        </h2>
        <DataTableResetButton tableId={PARTS_MAPPING_TABLE_ID} userId={userId} columns={columns} />
      </div>
      <DataTableFilterBar
        fields={filterFields}
        filters={filters}
        onFiltersChange={setFilters}
        onReset={resetFilters}
        sorted={sort !== null}
        rows={mappings}
      />
      <div className="rounded-xl bg-surface-card shadow-(--hairline-default)">
        <DataTable
          tableId={PARTS_MAPPING_TABLE_ID}
          userId={userId}
          columns={columns}
          rows={mappings}
          getRowKey={(mapping) => mapping.modelItemCode}
          aria-label="등록된 매핑 표"
          headClassName="bg-gray-75"
          sort={sort}
          onSortChange={setSort}
          filters={filters}
          filterFields={filterFields}
          empty={mappings.length > 0 ? <DataTableFilterEmpty onReset={resetFilters} /> : undefined}
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
