import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';

import type { Db, DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { importBatches, items, salesPrices, type ImportRowError } from '@/db/schema';
import { withTransaction } from '@/db/tx';
import {
  EMPTY_DUPLICATE_WARNINGS,
  splitDuplicateGroups,
  type DuplicateWarnings,
} from '@/lib/imports/duplicates';
import { AppError } from '@/lib/result';
import { writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';

import { listStagedCostDuplicateGroups } from './cost-duplicates';
import { KIND_DEFINITIONS, type ImportKind } from './kinds';
import { MAX_STORED_ERRORS, parseSheet, type ParseOutcome } from './parse-sheet';
import {
  MAX_IMPORT_FILE_BYTES,
  readWorkbook,
  WorkbookReadError,
  XLSX_MIME_TYPES,
} from './parse-xlsx';
import type { PartRow } from './schemas/parts';

/** 업로드 응답 미리보기 행 수 (§4.4.1: 상위 20행) */
export const PREVIEW_ROWS = 20;

export type UploadInput = {
  kind: ImportKind;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
};

export type UploadContext = { handle: DbHandle; actor: AuditActor; meta: RequestMeta };

export type UploadResult = {
  batchId: string;
  status: 'parsed' | 'failed';
  fileName: string;
  sheetName: string;
  headerRowIndex: number;
  rowCount: number;
  errorCount: number;
  preview: { rowIndex: number; row: Record<string, unknown> }[];
  errors: ImportRowError[];
  warnings: ImportRowError[];
  /** r4 §4.4.7: 원가 파일의 같은 날짜 중복 그룹(전부 / 값이 다른 그룹). 다른 종류는 비어 있다 */
  duplicateWarnings: DuplicateWarnings;
};

export const AUDIT_IMPORT_UPLOAD = 'import.upload';

function validateFile(input: UploadInput): void {
  if (!input.fileName.toLowerCase().endsWith('.xlsx')) {
    throw new AppError('VALIDATION', '엑셀(.xlsx) 파일만 업로드할 수 있습니다');
  }
  if (!(XLSX_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new AppError('VALIDATION', `지원하지 않는 파일 형식입니다 (${input.mimeType})`);
  }
  if (input.bytes.length === 0) throw new AppError('VALIDATION', '빈 파일입니다');
  if (input.bytes.length > MAX_IMPORT_FILE_BYTES) {
    throw new AppError('VALIDATION', '파일은 10MB 이하만 업로드할 수 있습니다');
  }
}

/**
 * 같은 종류에 같은 해시 파일이 있으면 409 + 기존 배치 안내("기존 파일 재사용" 유도, AC-24).
 * 실패한 배치는 재업로드를 막지 않도록 지우고 다시 받는다.
 */
async function guardDuplicate(db: Db, input: UploadInput, sha256: string): Promise<void> {
  const dbKind = KIND_DEFINITIONS[input.kind].dbKind;
  const [existing] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.kind, dbKind), eq(importBatches.fileSha256, sha256)))
    .limit(1);
  if (!existing) return;
  // 적용할 수 없는 배치(failed 또는 행 오류 있음)는 재업로드를 막지 않는다 — 지우고 다시 파싱한다
  if (existing.status === 'failed' || existing.errorCount > 0) {
    await db.delete(importBatches).where(eq(importBatches.id, existing.id));
    return;
  }
  throw new AppError(
    'CONFLICT',
    `이미 업로드된 파일입니다 (${existing.fileName}). '기존 파일 재사용'에서 선택하세요.`,
    undefined,
    { existingBatchId: existing.id, fileName: existing.fileName, status: existing.status },
  );
}

/** 파츠 매핑의 품번은 품목 마스터 또는 판매단가에 있어야 한다 (§4.4.7) */
async function validatePartCodes(db: Db, outcome: ParseOutcome<PartRow>) {
  const codes = [
    ...new Set(outcome.rows.flatMap(({ row }) => [row.modelItemCode, row.partItemCode])),
  ];
  if (codes.length === 0) return outcome;
  const known = new Set<string>();
  const fromItems = await db
    .select({ code: items.itemCode })
    .from(items)
    .where(inArray(items.itemCode, codes));
  const fromSales = await db
    .selectDistinct({ code: salesPrices.itemCode })
    .from(salesPrices)
    .where(inArray(salesPrices.itemCode, codes));
  for (const { code } of [...fromItems, ...fromSales]) known.add(code);
  const errors = [...outcome.errors];
  const rows = outcome.rows.filter(({ rowIndex, row }) => {
    const unknown = [row.modelItemCode, row.partItemCode].filter((code) => !known.has(code));
    for (const code of unknown) {
      errors.push({
        row: rowIndex,
        column: '품번',
        message: '존재하지 않는 품번입니다',
        value: code,
      });
    }
    return unknown.length === 0;
  });
  const added = errors.length - outcome.errors.length;
  return {
    ...outcome,
    rows,
    errorCount: outcome.errorCount + added,
    errors: errors.slice(0, MAX_STORED_ERRORS),
  };
}

async function parseUpload(db: Db, input: UploadInput): Promise<ParseOutcome<unknown>> {
  try {
    const sheets = await readWorkbook(input.bytes);
    const definition = KIND_DEFINITIONS[input.kind];
    const outcome = parseSheet(definition.spec as never, sheets) as ParseOutcome<unknown>;
    if (input.kind !== 'parts' || outcome.status === 'failed') return outcome;
    return (await validatePartCodes(db, outcome as ParseOutcome<PartRow>)) as ParseOutcome<unknown>;
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

/** 업로드 → 파싱·검증 → 배치 + 스테이징 + 감사 로그 (한 트랜잭션). 반영(적용)은 하지 않는다 */
export async function uploadImport(ctx: UploadContext, input: UploadInput): Promise<UploadResult> {
  validateFile(input);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  await guardDuplicate(ctx.handle.db, input, sha256);
  const outcome = await parseUpload(ctx.handle.db, input);
  const definition = KIND_DEFINITIONS[input.kind];

  const { batchId, duplicateWarnings } = await withTransaction(async (tx) => {
    const batch = firstRow(
      await tx
        .insert(importBatches)
        .values({
          kind: definition.dbKind,
          fileName: input.fileName,
          fileSha256: sha256,
          fileSize: input.bytes.length,
          headerRowIndex: outcome.headerRowIndex,
          rowCount: outcome.rowCount,
          errorCount: outcome.errorCount,
          status: outcome.status,
          errors: outcome.errors,
          warnings: outcome.warnings,
          uploadedBy: ctx.actor.id,
        })
        .returning({ id: importBatches.id }),
      'import_batches insert',
    );
    if (outcome.status === 'parsed') await definition.stage(tx, batch.id, outcome.rows as never);
    const duplicateWarnings =
      input.kind === 'costs' && outcome.status === 'parsed'
        ? splitDuplicateGroups(
            await listStagedCostDuplicateGroups(tx, batch.id, outcome.headerRowIndex),
          )
        : EMPTY_DUPLICATE_WARNINGS;
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_IMPORT_UPLOAD,
      target: { type: 'import_batch', id: batch.id, label: input.fileName },
      after: {
        kind: definition.dbKind,
        status: outcome.status,
        rowCount: outcome.rowCount,
        errorCount: outcome.errorCount,
      },
      result: outcome.status === 'failed' ? 'error' : 'success',
      meta: ctx.meta,
    });
    return { batchId: batch.id, duplicateWarnings };
  }, ctx.handle);

  return {
    batchId,
    status: outcome.status,
    fileName: input.fileName,
    sheetName: outcome.sheetName,
    headerRowIndex: outcome.headerRowIndex,
    rowCount: outcome.rowCount,
    errorCount: outcome.errorCount,
    preview: outcome.rows
      .slice(0, PREVIEW_ROWS)
      .map(({ rowIndex, row }) => ({ rowIndex, row: row as Record<string, unknown> })),
    errors: outcome.errors,
    warnings: outcome.warnings,
    duplicateWarnings,
  };
}
