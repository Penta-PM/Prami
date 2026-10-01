import { Pill } from '@/components/ui';

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
export function UploadSummary({ kind, data }: { kind: ImportFileKind; data: UploadSummaryData }) {
  const ok = data.status === 'parsed' && data.errorCount === 0;
  return (
    <div
      className="flex flex-col gap-3 rounded-lg bg-gray-75 p-3.5"
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
      {data.preview.length > 0 ? <PreviewTable kind={kind} data={data} /> : null}
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
        <ul className="m-0 list-none p-0 text-[12px] text-amber-500">
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
    <div role="alert" className="rounded-lg bg-red-500/10 p-3 text-[12px] text-red-500">
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

function PreviewTable({ kind, data }: { kind: ImportFileKind; data: UploadSummaryData }) {
  const columns = PREVIEW_COLUMNS[kind];
  return (
    <div className="overflow-x-auto rounded-lg bg-surface-card shadow-(--hairline-subtle)">
      <table aria-label="미리보기 (상위 20행)" className="w-full border-collapse text-[12px]">
        <thead className="bg-gray-75 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold text-text-tertiary">
              행
            </th>
            {columns.map(([, header]) => (
              <th
                key={header}
                scope="col"
                className="px-3 py-2 font-semibold whitespace-nowrap text-text-tertiary"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.preview.map(({ rowIndex, row }) => (
            <tr key={rowIndex} className="border-t border-border-subtle">
              <td className="px-3 py-1.5 text-text-tertiary">{rowIndex}</td>
              {columns.map(([key]) => (
                <td key={key} className="px-3 py-1.5 whitespace-nowrap">
                  {display(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
