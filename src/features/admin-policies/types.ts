import type { ImportRowError } from '@/db/schema';
import type { DuplicateWarnings } from '@/lib/imports/duplicates';

/** 클라이언트 컴포넌트가 주고받는 직렬화 가능한 모양 (서버 모듈을 import 하지 않기 위해 분리) */
export type BatchOption = {
  id: string;
  fileName: string;
  status: 'parsed' | 'failed' | 'applied' | 'superseded';
  rowCount: number;
  createdAt: string;
};

export type UploadSummaryData = {
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
  /** r4: 원가 같은 날짜 중복 그룹(전부 / 값이 다른 그룹). 다른 종류는 비어 있다 */
  duplicateWarnings: DuplicateWarnings;
};

export type FileMode = 'new' | 'reuse';

/** 한 파일 행의 선택 상태 → 적용에 쓸 배치 */
export type FileSelection = {
  mode: FileMode;
  upload: UploadSummaryData | null;
  reuseId: string;
};

export type ImportFileKind = 'sales' | 'items' | 'costs';

export function selectedBatchId(selection: FileSelection): string | null {
  if (selection.mode === 'reuse') return selection.reuseId || null;
  const upload = selection.upload;
  return upload && upload.status === 'parsed' && upload.errorCount === 0 ? upload.batchId : null;
}

/**
 * 적용을 막는지: 필수 파일은 적용 가능한 배치가 있어야 하고,
 * 선택 파일(품목조회)은 아무것도 고르지 않은 상태는 허용하되 오류 있는 업로드는 막는다.
 */
export function selectionBlocksApply(selection: FileSelection, optional: boolean): boolean {
  if (selection.mode === 'reuse') return !optional && !selection.reuseId;
  if (optional && selection.upload === null) return false;
  return selectedBatchId(selection) === null;
}
