'use client';

import { useMemo } from 'react';

import { Pill } from '@/components/ui';
import { DataTable, DataTableResetButton, type DataTableColumn } from '@/components/ui/data-table';
import { STATUS_ORDERS, type SortType, type SortValue } from '@/lib/table/compare';

import { DuplicateWarningLists } from './DuplicateWarningLists';
import type { ImportFileKind, UploadSummaryData } from './types';

/** 미리보기 표에 보일 컬럼 (행 객체 키 → 엑셀 헤더) */
const PREVIEW_COLUMNS: Record<ImportFileKind, readonly [string, string][]> = {
  sales: [
    ['itemCode', '품번'],
    ['itemName', '품명'],
    ['priceType', '단가유형'],
    ['priceCategory', '단가구분'],
    ['currency', '화폐'],
    ['unitPrice', '단가'],
    ['effectiveFrom', '적용시작일'],
    ['customerCode', '거래처코드'],
  ],
  items: [
    ['파일', '파일'],
    ['itemCode', '품번'],
    ['itemName', '품명'],
    ['categoryMajor', '대분류'],
    ['categoryMid', '중분류'],
    ['categoryMinor', '소분류'],
    ['itemStatus', '품목 상태'],
    ['itemKind', '종류'],
  ],
  parts: [
    ['modelItemCode', '모델품번'],
    ['modelName', '모델명'],
    ['partItemCode', '파츠품번'],
    ['partName', '파츠명'],
  ],
  costs: [
    ['materialCode', '자재번호'],
    ['materialName', '자재명'],
    ['unit', '단위'],
    ['priceType', '단가유형'],
    ['currency', '화폐'],
    ['unitCost', '단가'],
    ['effectiveFrom', '적용시작일'],
    ['isFinalSource', '최종여부'],
  ],
};

/** 표시할 오류 최대 건수 (나머지는 건수만) */
const VISIBLE_ERRORS = 50;

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/** 업로드 결과: 상태·건수, 미리보기(상위 20행), 오류 목록(행번호·컬럼·값), 경고 */
export function UploadSummary({
  kind,
  data,
  userId,
}: {
  kind: ImportFileKind;
  data: UploadSummaryData;
  /** 현재 사용자 id — 미리보기 표의 열 설정 저장 키 (#32 스펙 §5) */
  userId: string;
}) {
  const ok = data.status === 'parsed' && data.errorCount === 0;
  return (
    <div
      className="flex flex-col gap-3 rounded-lg bg-surface-muted p-3.5"
      aria-label={`${data.fileName} 검증 결과`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Pill tone={ok ? 'positive' : 'red'}>
          {ok ? '검증 통과' : data.status === 'failed' ? '실패' : '오류 있음'}
        </Pill>
        <span className="font-semibold">{data.fileName}</span>
        {data.sheetName ? (
          <span className="text-text-tertiary">
            시트 {data.sheetName} · 헤더 {data.headerRowIndex + 1}행
          </span>
        ) : null}
        <span className="text-text-tertiary">
          데이터 {data.rowCount.toLocaleString('ko-KR')}행 · 오류{' '}
          {data.errorCount.toLocaleString('ko-KR')}건
          {data.warnings.length > 0 ? ` · 경고 ${data.warnings.length}건` : ''}
          {data.duplicateWarnings.sameDateDuplicates.length > 0
            ? ` · 같은 날짜 중복 ${data.duplicateWarnings.sameDateDuplicates.length}그룹`
            : ''}
        </span>
      </div>
      {data.sourceFiles && data.sourceFiles.length > 0 ? (
        <ul
          aria-label="업로드 파일"
          className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px]"
        >
          {data.sourceFiles.map((file) => (
            <li key={file.sha256}>
              {file.name} · {file.rowCount.toLocaleString('ko-KR')}행 · {file.majors.join(', ')}
            </li>
          ))}
        </ul>
      ) : null}
      {data.errors.length > 0 ? <ErrorList errors={data.errors} total={data.errorCount} /> : null}
      <WarningLists data={data} />
      {data.preview.length > 0 ? <PreviewTable kind={kind} data={data} userId={userId} /> : null}
    </div>
  );
}

const DUPLICATE_COLUMNS = ['같은 날짜 중복', '같은 날짜 중복(값 다름)'];

/** 경고 목록 — 원가 같은 날짜 중복은 행 단위가 아니라 그룹 목록(DuplicateWarningLists)으로 보여 준다 (r4 §4.4.7 3) */
function WarningLists({ data }: { data: UploadSummaryData }) {
  const others = data.warnings.filter((w) => !DUPLICATE_COLUMNS.includes(w.column));
  return (
    <>
      <DuplicateWarningLists
        warnings={data.duplicateWarnings}
        stage="preview"
        headerRowIndex={data.headerRowIndex}
      />
      {others.length > 0 ? (
        <ul className="m-0 list-none p-0 text-[12px] text-warning-700">
          {others.slice(0, 10).map((warning, index) => (
            <li key={index}>
              경고: {warning.file ? `${warning.file} · ` : ''}
              {warning.column} — {warning.message}
            </li>
          ))}
          {others.length > 10 ? <li>외 경고 {others.length - 10}건</li> : null}
        </ul>
      ) : null}
    </>
  );
}

function ErrorList({ errors, total }: { errors: UploadSummaryData['errors']; total: number }) {
  return (
    <div role="alert" className="rounded-lg bg-surface-danger p-3 text-[12px] text-text-danger">
      <p className="m-0 mb-1.5 font-semibold">
        오류 {total.toLocaleString('ko-KR')}건 — 오류가 없어야 적용할 수 있습니다
      </p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {errors.slice(0, VISIBLE_ERRORS).map((error, index) => (
          <li key={index}>
            {error.file ? `${error.file} ` : ''}
            {error.row > 0 ? `${error.row}행` : '파일'}
            {error.column ? ` · ${error.column}` : ''} — {error.message}
            {error.value !== undefined && error.value !== null
              ? ` (값: ${display(error.value)})`
              : ''}
          </li>
        ))}
      </ul>
      {total > VISIBLE_ERRORS ? <p className="m-0 mt-1.5">외 {total - VISIBLE_ERRORS}건</p> : null}
    </div>
  );
}

type PreviewRow = UploadSummaryData['preview'][number];

/** 미리보기 키별 정렬 타입 (#32 스펙 §2). 여기에 없는 키는 text */
const PREVIEW_SORT_TYPES: Partial<Record<string, SortType>> = {
  unitPrice: 'number',
  unitCost: 'number',
  effectiveFrom: 'date',
  itemStatus: 'status',
};

/** 업로드 원본 값 → 정렬 값. 빈 값은 null(맨 뒤) */
function rawSortValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/** 금액: 같은 미리보기에 화폐가 섞일 수 있어 화폐로 먼저 묶는다 (#32 스펙 §2). 숫자로 못 읽으면 NaN → 빈 값 취급 */
function moneySortValue(row: Record<string, unknown>, key: string): SortValue {
  const raw = rawSortValue(row[key]);
  if (raw === null) return null;
  return { amount: Number(raw.replaceAll(',', '')), currency: rawSortValue(row.currency) ?? '' };
}

function previewTableId(kind: ImportFileKind): string {
  // 종류마다 열 구성이 달라 저장 키를 나눈다 — 한 화면에 판매단가·품목조회 미리보기가 함께 떠도 서로의 순서를 지우지 않는다
  return `upload-preview-${kind}`;
}

function PreviewTable({
  kind,
  data,
  userId,
}: {
  kind: ImportFileKind;
  data: UploadSummaryData;
  userId: string;
}) {
  // 열 배열은 저장 레이아웃 정규화의 기준이라 렌더마다 새로 만들지 않는다
  const columns = useMemo<DataTableColumn<PreviewRow>[]>(
    () => [
      {
        id: 'rowIndex',
        header: '행',
        type: 'number',
        pinned: 'start',
        sortValue: ({ rowIndex }) => rowIndex,
        headerClassName: 'py-2',
        cellClassName: 'py-1.5 text-text-tertiary',
        cell: ({ rowIndex }) => rowIndex,
      },
      ...PREVIEW_COLUMNS[kind].map(([key, header]): DataTableColumn<PreviewRow> => {
        const type = PREVIEW_SORT_TYPES[key] ?? 'text';
        return {
          id: key,
          header,
          type,
          statusOrder: type === 'status' ? STATUS_ORDERS.partMapping : undefined,
          sortValue:
            type === 'number'
              ? ({ row }) => moneySortValue(row, key)
              : ({ row }) => rawSortValue(row[key]),
          headerClassName: 'py-2',
          cellClassName: 'py-1.5 whitespace-nowrap',
          cell: ({ row }) => display(row[key]),
        };
      }),
    ],
    [kind],
  );
  const tableId = previewTableId(kind);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-text-tertiary">상위 20행 안에서 정렬</span>
        <DataTableResetButton tableId={tableId} userId={userId} columns={columns} />
      </div>
      <div className="overflow-x-auto rounded-lg bg-surface-card shadow-(--hairline-subtle)">
        <DataTable
          tableId={tableId}
          userId={userId}
          columns={columns}
          rows={data.preview}
          getRowKey={({ rowIndex }) => String(rowIndex)}
          aria-label="미리보기 (상위 20행)"
          className="text-[12px]"
          headClassName="bg-surface-muted"
          // 기존 미리보기 모습 유지 — 행 위 테두리, hover 배경 없음
          rowClassName={() => 'border-t border-b-0 hover:bg-transparent'}
        />
      </div>
    </div>
  );
}
