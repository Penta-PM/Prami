import type { ImportRowError } from '@/db/schema';

import type { ParsedRow } from './parse-sheet';
import type { ItemRow } from './schemas/items';

/**
 * 품목조회 다중 파일 배치 검증 (PRAMI-003 §4.2.3) — DB 없이 판정하는 부분.
 * 오류·경고에는 품번·파일명·행 번호·헤더명만 담는다(개인정보 컬럼 값은 파싱 단계에서 읽지 않는다).
 */
export type ParsedItemFile = {
  name: string;
  sha256: string;
  rows: ParsedRow<ItemRow>[];
};

/** 같은 SHA-256 파일이 배치 안에 2개 이상 → 오류 duplicate_file */
export function duplicateFileErrors(files: readonly { name: string; sha256: string }[]) {
  const seen = new Map<string, string>();
  const errors: ImportRowError[] = [];
  for (const file of files) {
    const earlier = seen.get(file.sha256);
    if (earlier) {
      errors.push({
        row: 0,
        column: '',
        code: 'duplicate_file',
        file: file.name,
        message: `같은 파일이 두 번 선택됐습니다 (${earlier})`,
      });
    } else seen.set(file.sha256, file.name);
  }
  return errors;
}

/** 파일 간 같은 품번 → 오류 duplicate_item_code (품번·두 파일명·행 번호). 파일 내 중복은 파서가 이미 잡는다 */
export function crossFileDuplicateErrors(files: readonly ParsedItemFile[]): ImportRowError[] {
  const first = new Map<string, { file: string; row: number }>();
  const errors: ImportRowError[] = [];
  for (const file of files) {
    for (const { rowIndex, row } of file.rows) {
      const earlier = first.get(row.itemCode);
      if (earlier && earlier.file !== file.name) {
        errors.push({
          row: rowIndex,
          column: '품번',
          code: 'duplicate_item_code',
          file: file.name,
          value: row.itemCode,
          message: `같은 품번이 ${earlier.file} ${earlier.row}행에도 있습니다`,
        });
      } else if (!earlier) first.set(row.itemCode, { file: file.name, row: rowIndex });
    }
  }
  return errors;
}

export function majorsOf(rows: readonly ParsedRow<ItemRow>[]): string[] {
  return [...new Set(rows.map(({ row }) => row.categoryMajor))].sort();
}

/** 파일 하나에 대분류가 2종 이상 → 경고 mixed_major_in_file (병합 파일 1개는 예외 아님 — 경고만) */
export function mixedMajorWarnings(files: readonly ParsedItemFile[]): ImportRowError[] {
  return files
    .map((file) => ({ file, majors: majorsOf(file.rows) }))
    .filter(({ majors }) => majors.length > 1)
    .map(({ file, majors }) => ({
      row: 0,
      column: '품목대분류',
      code: 'mixed_major_in_file',
      file: file.name,
      value: majors,
      message: `한 파일에 대분류가 ${majors.length}종 있습니다 (${majors.join(', ')})`,
    }));
}

/** 직전 적용 품목에 있던 대분류 중 이번 배치에 없는 것 */
export function missingFamilies(previous: readonly string[], current: readonly string[]): string[] {
  const now = new Set(current);
  return previous.filter((major) => !now.has(major)).sort();
}

/** 판매단가 품번 목록 상위 표시 수 */
export const NOT_COVERED_LIST_LIMIT = 50;

export function notCoveredWarning(codes: readonly string[]): ImportRowError | null {
  if (codes.length === 0) return null;
  return {
    row: 0,
    column: '품번',
    code: 'sales_items_not_covered',
    value: [...codes].sort().slice(0, NOT_COVERED_LIST_LIMIT),
    message: `현재 판매단가 품번 ${codes.length}개가 이번 품목 파일에 없습니다 — 적용 시 stub(미확인)으로 남습니다`,
  };
}

/** 개인정보 제외 컬럼을 버렸다는 정보 (헤더명만, 값 없음) */
export function excludedColumnsInfo(dropped: readonly string[]): ImportRowError | null {
  if (dropped.length === 0) return null;
  return {
    row: 0,
    column: dropped.join(', '),
    code: 'excluded_columns_dropped',
    value: dropped.length,
    message: `개인정보 컬럼 ${dropped.length}개(${dropped.join(', ')})는 저장하지 않았습니다`,
  };
}

export function missingFamiliesWarning(
  missing: readonly string[],
  vanishing: number,
): ImportRowError | null {
  if (missing.length === 0) return null;
  return {
    row: 0,
    column: '품목대분류',
    code: 'missing_families',
    value: [...missing],
    message: `직전 적용 품목의 대분류 ${missing.join(', ')} 가 이번 배치에 없습니다 — 적용 시 병합 방식을 선택하세요 (전량 교체 시 ${vanishing}개 품번이 사라집니다)`,
  };
}
