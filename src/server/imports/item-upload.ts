import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { firstRow } from '@/db/rows';
import {
  importBatches,
  items,
  salesPrices,
  stgItems,
  type ImportRowError,
  type ImportSourceFile,
} from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import {
  MAX_ITEM_FILES,
  MAX_ITEM_TOTAL_BYTES,
  TOO_LARGE_ITEM_TOTAL_MESSAGE,
} from '@/lib/constants/upload-limits';
import { EMPTY_DUPLICATE_WARNINGS } from '@/lib/imports/duplicates';
import { AppError } from '@/lib/result';
import { writeAudit } from '@/server/audit/log';

import {
  crossFileDuplicateErrors,
  duplicateFileErrors,
  excludedColumnsInfo,
  majorsOf,
  missingFamilies,
  missingFamiliesWarning,
  mixedMajorWarnings,
  notCoveredWarning,
  type ParsedItemFile,
} from './item-checks';
import { STAGE_CHUNK_SIZE } from './kinds';
import { MAX_STORED_ERRORS, parseSheet, type ParseOutcome } from './parse-sheet';
import { readWorkbook, WorkbookReadError } from './parse-xlsx';
import { ITEM_SPEC, type ItemRow } from './schemas/items';
import {
  AUDIT_IMPORT_UPLOAD,
  guardDuplicateBatch,
  PREVIEW_ROWS,
  validateFile,
  type UploadContext,
  type UploadInput,
  type UploadResult,
} from './upload';

/**
 * 품목조회 다중 파일 업로드 (PRAMI-003 §4.2.3): 파일 1~5개(또는 병합 파일 1개) → 배치 1개.
 * 파일별 파싱(39컬럼, 개인정보 제외) → 파일 간 검증 → 배치·스테이징·감사 (한 트랜잭션). 적용은 하지 않는다.
 */
export { MAX_ITEM_FILES, MAX_ITEM_TOTAL_BYTES };

type ItemFileInput = Omit<UploadInput, 'kind'>;

function validateFiles(files: readonly ItemFileInput[]) {
  if (files.length === 0) throw new AppError('VALIDATION', '품목조회 파일을 선택하세요');
  if (files.length > MAX_ITEM_FILES) {
    throw new AppError('VALIDATION', `품목조회 파일은 한 번에 ${MAX_ITEM_FILES}개까지입니다`);
  }
  for (const file of files) validateFile(file);
  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > MAX_ITEM_TOTAL_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', TOO_LARGE_ITEM_TOTAL_MESSAGE);
  }
}

function fileError(name: string, error: ImportRowError): ImportRowError {
  return { ...error, file: name };
}

async function parseFile(file: ItemFileInput): Promise<ParseOutcome<ItemRow>> {
  try {
    return parseSheet(ITEM_SPEC, await readWorkbook(file.bytes));
  } catch (error) {
    if (!(error instanceof WorkbookReadError)) throw error;
    return {
      status: 'failed',
      sheetName: '',
      headerRowIndex: 0,
      rows: [],
      rowCount: 0,
      errorCount: 1,
      errors: [{ row: 0, column: '', message: error.message }],
      warnings: [],
    };
  }
}

/** 파일 해시 집합의 대표 해시 (같은 파일 묶음 재업로드 감지, 순서 무관) */
function combinedSha(shas: readonly string[]): string {
  return createHash('sha256')
    .update([...shas].sort().join('\n'))
    .digest('hex');
}

/** 직전 적용 품목(master)의 대분류·품번 수 — missing_families 와 전량 교체 시 사라질 수 */
async function previousMajors(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ major: items.categoryMajor, n: sql<number>`count(*)::int` })
    .from(items)
    .where(eq(items.source, 'master'))
    .groupBy(items.categoryMajor);
  return new Map(rows.filter((row) => row.major).map((row) => [row.major!, Number(row.n)]));
}

async function notCoveredCodes(db: Db, codes: ReadonlySet<string>): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: salesPrices.itemCode })
    .from(salesPrices)
    .where(isNull(salesPrices.deletedAt));
  return rows.map((row) => row.code).filter((code) => !codes.has(code));
}

type BatchDraft = {
  files: ParsedItemFile[];
  outcomes: ParseOutcome<ItemRow>[];
  errors: ImportRowError[];
  warnings: ImportRowError[];
  missing: string[];
  vanishing: number;
};

async function draftBatch(db: Db, inputs: readonly ItemFileInput[]): Promise<BatchDraft> {
  const shas = inputs.map((file) => createHash('sha256').update(file.bytes).digest('hex'));
  const duplicates = duplicateFileErrors(
    inputs.map((file, i) => ({ name: file.fileName, sha256: shas[i]! })),
  );
  if (duplicates.length > 0) {
    throw new AppError('VALIDATION', '같은 파일이 두 번 선택됐습니다', undefined, {
      errors: duplicates,
    });
  }
  const outcomes = await Promise.all(inputs.map(parseFile));
  const failed = outcomes.flatMap((outcome, i) =>
    outcome.status === 'failed' ? outcome.errors.map((e) => fileError(inputs[i]!.fileName, e)) : [],
  );
  // 필수 헤더 누락·읽기 실패 파일이 있으면 배치를 만들지 않는다 (AC-301)
  if (failed.length > 0) {
    throw new AppError('VALIDATION', '품목조회 파일을 읽을 수 없습니다', undefined, {
      errors: failed,
    });
  }
  const files = outcomes.map((outcome, i) => ({
    name: inputs[i]!.fileName,
    sha256: shas[i]!,
    rows: outcome.rows,
  }));
  const codes = new Set(files.flatMap((file) => file.rows.map(({ row }) => row.itemCode)));
  const previous = await previousMajors(db);
  const missing = missingFamilies([...previous.keys()], majorsOf(files.flatMap((f) => f.rows)));
  const vanishing = missing.reduce((sum, major) => sum + (previous.get(major) ?? 0), 0);
  const dropped = [...new Set(outcomes.flatMap((outcome) => outcome.droppedColumns ?? []))];
  const errors = [
    ...outcomes.flatMap((outcome, i) => outcome.errors.map((e) => fileError(files[i]!.name, e))),
    ...crossFileDuplicateErrors(files),
  ];
  const warnings = [
    ...outcomes.flatMap((outcome, i) => outcome.warnings.map((w) => fileError(files[i]!.name, w))),
    ...mixedMajorWarnings(files),
    ...[
      missingFamiliesWarning(missing, vanishing),
      notCoveredWarning(await notCoveredCodes(db, codes)),
      excludedColumnsInfo(dropped),
    ].filter((warning): warning is ImportRowError => warning !== null),
  ];
  return { files, outcomes, errors, warnings, missing, vanishing };
}

async function stageRows(tx: Tx, batchId: string, files: readonly ParsedItemFile[]) {
  const rows = files.flatMap((file) =>
    file.rows.map(({ rowIndex, row }) => ({ file: file.name, fileRow: rowIndex, row })),
  );
  for (let start = 0; start < rows.length; start += STAGE_CHUNK_SIZE) {
    await tx.insert(stgItems).values(
      rows.slice(start, start + STAGE_CHUNK_SIZE).map(({ file, fileRow, row }, offset) => ({
        batchId,
        rowIndex: start + offset + 1,
        sourceFile: file,
        fileRow,
        ...row,
      })),
    );
  }
}

function sourceFilesOf(draft: BatchDraft): ImportSourceFile[] {
  return draft.files.map((file, i) => ({
    name: file.name,
    sha256: file.sha256,
    rowCount: draft.outcomes[i]!.rowCount,
    majors: majorsOf(file.rows),
  }));
}

function batchName(names: readonly string[]): string {
  return names.length === 1 ? names[0]! : `${names[0]} 외 ${names.length - 1}개`;
}

export async function uploadItemFiles(
  ctx: UploadContext,
  inputs: readonly ItemFileInput[],
): Promise<UploadResult> {
  validateFiles(inputs);
  const draft = await draftBatch(ctx.handle.db, inputs);
  const sourceFiles = sourceFilesOf(draft);
  const sha256 = combinedSha(sourceFiles.map((file) => file.sha256));
  await guardDuplicateBatch(ctx.handle.db, 'item_master', sha256);
  const crossFileFailed = draft.errors.some((e) => e.code === 'duplicate_item_code' && e.file);
  const status = crossFileFailed ? 'failed' : 'parsed';
  const rowCount = draft.outcomes.reduce((sum, outcome) => sum + outcome.rowCount, 0);
  const fileName = batchName(sourceFiles.map((file) => file.name));

  const batchId = await withTransaction(async (tx) => {
    const batch = firstRow(
      await tx
        .insert(importBatches)
        .values({
          kind: 'item_master',
          fileName,
          fileSha256: sha256,
          fileSize: inputs.reduce((sum, file) => sum + file.bytes.length, 0),
          headerRowIndex: draft.outcomes[0]!.headerRowIndex,
          rowCount,
          errorCount: draft.errors.length,
          status,
          errors: draft.errors.slice(0, MAX_STORED_ERRORS),
          warnings: draft.warnings.slice(0, MAX_STORED_ERRORS),
          sourceFiles,
          uploadedBy: ctx.actor.id,
        })
        .returning({ id: importBatches.id }),
      'import_batches insert',
    );
    if (status === 'parsed') await stageRows(tx, batch.id, draft.files);
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_IMPORT_UPLOAD,
      target: { type: 'import_batch', id: batch.id, label: fileName },
      after: {
        kind: 'item_master',
        status,
        rowCount,
        errorCount: draft.errors.length,
        files: sourceFiles.length,
      },
      result: status === 'failed' ? 'error' : 'success',
      meta: ctx.meta,
    });
    return batch.id;
  }, ctx.handle);

  return {
    batchId,
    status,
    fileName,
    sheetName: draft.outcomes[0]!.sheetName,
    headerRowIndex: draft.outcomes[0]!.headerRowIndex,
    rowCount,
    errorCount: draft.errors.length,
    preview: draft.files
      .flatMap((file) =>
        file.rows.map(({ rowIndex, row }) => ({ rowIndex, row: { ...row, 파일: file.name } })),
      )
      .slice(0, PREVIEW_ROWS)
      .map(({ rowIndex, row }) => ({ rowIndex, row: row as Record<string, unknown> })),
    errors: draft.errors.slice(0, MAX_STORED_ERRORS),
    warnings: draft.warnings.slice(0, MAX_STORED_ERRORS),
    duplicateWarnings: EMPTY_DUPLICATE_WARNINGS,
    sourceFiles,
    itemMerge: { missingFamilies: draft.missing, vanishingItems: draft.vanishing },
  };
}

/** 적용 화면용: 배치의 대분류 집합 (병합 방식 판정) */
export async function batchMajors(db: Db, batchId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ major: stgItems.categoryMajor })
    .from(stgItems)
    .where(and(eq(stgItems.batchId, batchId)));
  return rows
    .map((row) => row.major)
    .filter((major): major is string => major !== null)
    .sort();
}
