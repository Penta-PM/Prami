import type { ImportRowError } from '@/db/schema';

import type { Cell } from './cells';
import { detectHeader } from './header-detect';
import { pickSheet, type Worksheet } from './parse-xlsx';
import type { SheetSpec } from './schemas/types';

/** import_batches.errors 에 저장하는 최대 건수 (§4.3.3). error_count 는 전체 건수 */
export const MAX_STORED_ERRORS = 500;

/** rowIndex = 엑셀 행 번호 (1-base) — 스테이징 row_index 로 저장해 오류·미리보기를 원본 행과 잇는다 */
export type ParsedRow<Row> = { rowIndex: number; row: Row };

export type ParseOutcome<Row> = {
  status: 'parsed' | 'failed';
  sheetName: string;
  headerRowIndex: number;
  rows: ParsedRow<Row>[];
  /** 데이터 행 수 (헤더 아래 빈 행 제외) */
  rowCount: number;
  errorCount: number;
  errors: ImportRowError[];
  warnings: ImportRowError[];
  /** (strictHeaders) 파일에 있었지만 저장하지 않은 제외 컬럼 헤더 (excluded_columns_dropped 정보용) */
  droppedColumns?: string[];
};

type RowContext = { excelRow: number; errors: ImportRowError[] };

/** 같은 날짜 중복 경고 컬럼명 — UploadSummary 가 값이 다른 중복을 별도 목록으로 보여 주는 기준 */
export const DUPLICATE_WARNING_COLUMN = '같은 날짜 중복';
export const CONFLICTING_DUPLICATE_WARNING_COLUMN = '같은 날짜 중복(값 다름)';

function duplicateWarning<Row>(
  spec: SheetSpec<Row>,
  row: Row,
  earlier: { row: number; value: string | undefined },
  excelRow: number,
  key: string,
): ImportRowError {
  const value = spec.uniqueKey!.compareValue?.(row);
  const conflicting = earlier.value !== undefined && value !== undefined && earlier.value !== value;
  return {
    row: excelRow,
    column: conflicting ? CONFLICTING_DUPLICATE_WARNING_COLUMN : DUPLICATE_WARNING_COLUMN,
    message: conflicting
      ? `${earlier.row}행과 같은 계열·적용시작일이지만 값이 다릅니다 (${earlier.value} ≠ ${value}) — 둘 다 적재되며 뒤 행이 우선합니다`
      : `${earlier.row}행과 같은 계열·적용시작일입니다 (값 동일) — 둘 다 적재됩니다`,
    value: key,
  };
}

function isBlankRow(row: readonly Cell[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '');
}

function failed<Row>(
  sheetName: string,
  headerRowIndex: number,
  message: string,
): ParseOutcome<Row> {
  return {
    status: 'failed',
    sheetName,
    headerRowIndex,
    rows: [],
    rowCount: 0,
    errorCount: 1,
    errors: [{ row: 0, column: '', message }],
    warnings: [],
  };
}

/** 한 행의 각 컬럼을 변환한다. 컬럼별 오류를 모두 모은다 (행번호·컬럼·값) */
function convertRow<Row>(
  spec: SheetSpec<Row>,
  cells: readonly Cell[],
  columns: Map<string, number>,
  extraColumns: { header: string; column: number }[],
  ctx: RowContext,
): Row | null {
  const values: Record<string, unknown> = {};
  let valid = true;
  for (const column of spec.columns) {
    const index = columns.get(column.header);
    const cell = index === undefined ? null : (cells[index] ?? null);
    const result = column.schema.safeParse(cell);
    if (result.success) {
      values[column.key] = result.data;
    } else {
      valid = false;
      const message = result.error.issues[0]?.message ?? '값이 올바르지 않습니다';
      ctx.errors.push({
        row: ctx.excelRow,
        column: column.header,
        message,
        value: cell ?? null,
        ...(column.errorCode ? { code: column.errorCode } : {}),
      });
    }
  }
  if (!valid) return null;
  return spec.build(values, extrasOf(spec, cells, columns, extraColumns));
}

function isBlankCell(cell: Cell): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');
}

/**
 * build 의 두 번째 인자. 기본: 정의에 없는 컬럼 원문 전부. strictHeaders: rawColumns 만, 빈 값은 키 생략
 * (제외 컬럼·미지 컬럼 값은 읽지 않는다 — PRAMI-003 §4.2.1·§4.2.2).
 */
function extrasOf<Row>(
  spec: SheetSpec<Row>,
  cells: readonly Cell[],
  columns: Map<string, number>,
  extraColumns: { header: string; column: number }[],
): Record<string, unknown> {
  if (!spec.strictHeaders) {
    return Object.fromEntries(
      extraColumns.map(({ header, column }) => [header, cells[column] ?? null]),
    );
  }
  const raw: Record<string, unknown> = {};
  for (const header of spec.rawColumns ?? []) {
    const index = columns.get(header);
    const cell = index === undefined ? null : (cells[index] ?? null);
    if (!isBlankCell(cell)) raw[header] = cell;
  }
  return raw;
}

/** 헤더 경고: 기본은 "무시한 추가 컬럼", strictHeaders 는 extra_header(저장 안 함) + missing_header */
function headerWarnings<Row>(
  spec: SheetSpec<Row>,
  headerRow: number,
  columns: Map<string, number>,
  extras: { header: string }[],
): ImportRowError[] {
  if (!spec.strictHeaders) {
    return extras.map(({ header }) => ({
      row: headerRow,
      column: header,
      message: '정의되지 않은 컬럼이라 무시했습니다',
    }));
  }
  const defined = [
    ...spec.columns.map((column) => column.header),
    ...(spec.rawColumns ?? []),
    ...(spec.excludedColumns ?? []),
  ];
  return [
    ...extras.map(({ header }) => ({
      row: headerRow,
      column: header,
      code: 'extra_header',
      message: '정의되지 않은 컬럼입니다 — 값을 저장하지 않습니다',
    })),
    ...defined
      .filter((header) => !columns.has(header))
      .map((header) => ({
        row: headerRow,
        column: header,
        code: 'missing_header',
        message: '헤더가 없습니다 (필수 아님 — 빈 값으로 처리)',
      })),
  ];
}

/**
 * 워크북 → 검증된 행 (§4.4.1). 헤더 누락이면 배치 failed + 누락 헤더명 나열.
 * 행 오류가 있어도 배치는 parsed 로 남기되(미리보기·오류 목록), 적용은 오류 0건일 때만 허용한다.
 */
export function parseSheet<Row>(
  spec: SheetSpec<Row>,
  sheets: readonly Worksheet[],
): ParseOutcome<Row> {
  const sheet = pickSheet(sheets, spec.preferredSheets);
  const required = spec.columns.filter((column) => column.required).map((column) => column.header);
  const known = [
    ...spec.columns.map((column) => column.header),
    ...(spec.rawColumns ?? []),
    ...(spec.excludedColumns ?? []),
  ];
  const header = detectHeader(sheet.rows, required, known);
  if (!header.ok) {
    const outcome = failed<Row>(
      sheet.name,
      header.bestRowIndex,
      `필수 헤더 누락: ${header.missing.join(', ')}`,
    );
    if (spec.strictHeaders) outcome.errors[0]!.code = 'missing_required_header';
    return outcome;
  }

  const errors: ImportRowError[] = [];
  const warnings = headerWarnings(spec, header.rowIndex + 1, header.columns, header.extras);
  const rows: ParsedRow<Row>[] = [];
  const seen = new Map<string, { row: number; value: string | undefined }>();
  let rowCount = 0;

  sheet.rows.slice(header.rowIndex + 1).forEach((cells, offset) => {
    if (isBlankRow(cells)) return;
    rowCount += 1;
    const excelRow = header.rowIndex + offset + 2;
    const row = convertRow(spec, cells, header.columns, header.extras, { excelRow, errors });
    if (row === null) return;
    const key = spec.uniqueKey?.of(row);
    const earlier = key === undefined ? undefined : seen.get(key);
    if (key !== undefined && earlier !== undefined) {
      if (spec.uniqueKey!.policy !== 'warn') {
        errors.push({
          row: excelRow,
          column: spec.uniqueKey!.column ?? '',
          message: `${spec.uniqueKey!.describe} (${earlier.row}행)`,
          value: key,
          ...(spec.uniqueKey!.errorCode ? { code: spec.uniqueKey!.errorCode } : {}),
        });
        return;
      }
      warnings.push(duplicateWarning(spec, row, earlier, excelRow, key));
    } else if (key !== undefined) {
      seen.set(key, { row: excelRow, value: spec.uniqueKey!.compareValue?.(row) });
    }
    rows.push({ rowIndex: excelRow, row });
  });

  if (rowCount === 0) return failed(sheet.name, header.rowIndex, '데이터 행이 없습니다');
  const droppedColumns = spec.strictHeaders
    ? (spec.excludedColumns ?? []).filter((name) => header.columns.has(name))
    : undefined;
  return {
    ...(droppedColumns ? { droppedColumns } : {}),
    status: 'parsed',
    sheetName: sheet.name,
    headerRowIndex: header.rowIndex,
    rows,
    rowCount,
    errorCount: errors.length,
    errors: errors.slice(0, MAX_STORED_ERRORS),
    warnings: warnings.slice(0, MAX_STORED_ERRORS),
  };
}
