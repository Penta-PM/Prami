/**
 * 품목-원가 매칭 파일 (ERP 기본정보 > 품목 > 품목조회(추가정보)) 형식 규칙 (스펙 erp-upload-guide §6.2).
 * 브라우저(매칭 파일 업로드 — 원본은 브라우저에서만 읽는다)와 서버(품목상태 업로드 오업로드 거부)가 함께 쓰는 순수 모듈.
 *
 * 기밀: 이 모듈은 셀 값을 저장·기록하지 않는다. 결과는 {품목코드, 자재번호} 쌍과 건수뿐이고,
 * 다른 열(품명·대체품·추가자재 등)은 읽지 않는다.
 */
import { MAX_IMPORT_FILE_BYTES } from '@/lib/constants/upload-limits';

/** 1행 제목 */
export const COST_LINK_FILE_TITLE = '품목조회(추가정보)';
/** 필수 헤더 — 품목코드(품번)·원가 자재번호(원자재품번). 이 두 열만 쓴다 */
export const COST_LINK_ITEM_HEADER = '품번';
export const COST_LINK_MATERIAL_HEADER = '원자재품번(필수)';
export const COST_LINK_REQUIRED_HEADERS = [COST_LINK_ITEM_HEADER, COST_LINK_MATERIAL_HEADER];

/** 파일 크기 상한 (다른 업로드와 같은 10MB) · 데이터 행 상한 */
export const COST_LINK_FILE_MAX_BYTES = MAX_IMPORT_FILE_BYTES;
export const COST_LINK_FILE_MAX_ROWS = 5000;

export const COST_LINK_FILE_FORMAT_MESSAGE = '품목-원가 매칭 파일 형식이 아닙니다';
export const COST_LINK_FILE_TOO_LARGE_MESSAGE = '파일은 10MB 이하만 업로드할 수 있습니다';
export const COST_LINK_FILE_TOO_MANY_ROWS_MESSAGE = `품목-원가 매칭 파일은 ${COST_LINK_FILE_MAX_ROWS.toLocaleString('ko-KR')}행까지 올릴 수 있습니다`;
export const COST_LINK_FILE_EMPTY_MESSAGE = '품번·원자재품번이 모두 있는 행이 없습니다';
/** 품목상태 칸(가격정책 관리)에 매칭 파일을 올린 경우 — 스테이징 적재 전에 거부 */
export const COST_LINK_FILE_MISUPLOAD_MESSAGE =
  '품목-원가 매칭 파일입니다. 원가 매핑 화면에서 업로드하세요.';

/** 헤더 탐색 범위 — 규격은 2행이지만 제목 행이 빠진 파일도 받는다(다른 임포트와 같은 상위 5행) */
const HEADER_SCAN_ROWS = 5;

export type CostLinkCell = string | number | boolean | Date | null | undefined;
export type CostLinkPair = { itemCode: string; materialCode: string };

function text(cell: CostLinkCell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

/** 1행 제목이 매칭 파일 제목이거나, 상위 행에 "원자재품번(필수)" 헤더가 있으면 매칭 파일로 본다 */
export function looksLikeCostLinkFile(rows: readonly (readonly CostLinkCell[])[]): boolean {
  if ((rows[0] ?? []).some((cell) => text(cell) === COST_LINK_FILE_TITLE)) return true;
  return rows
    .slice(0, HEADER_SCAN_ROWS)
    .some((row) => row.some((cell) => text(cell) === COST_LINK_MATERIAL_HEADER));
}

export type CostLinkFileResult =
  | {
      ok: true;
      pairs: CostLinkPair[];
      /** 빈 행을 뺀 데이터 행 수 */
      rowCount: number;
      /** 품번 또는 원자재품번이 비어 건너뛴 행 수 */
      skipped: number;
    }
  | { ok: false; message: string };

/**
 * 시트 행 → 쌍. 필수 헤더 두 개가 같은 행(상위 5행 중)에 있어야 한다. 그 아래 행 중 둘 다 값이 있는 행만 쌍으로.
 * 다른 열은 읽지 않는다.
 */
export function extractCostLinkPairs(
  rows: readonly (readonly CostLinkCell[])[],
): CostLinkFileResult {
  let headerRow = -1;
  let itemColumn = -1;
  let materialColumn = -1;
  for (let index = 0; index < Math.min(HEADER_SCAN_ROWS, rows.length); index += 1) {
    const cells = (rows[index] ?? []).map(text);
    const item = cells.indexOf(COST_LINK_ITEM_HEADER);
    const material = cells.indexOf(COST_LINK_MATERIAL_HEADER);
    if (item >= 0 && material >= 0) {
      headerRow = index;
      itemColumn = item;
      materialColumn = material;
      break;
    }
  }
  if (headerRow < 0) return { ok: false, message: COST_LINK_FILE_FORMAT_MESSAGE };

  const pairs: CostLinkPair[] = [];
  let rowCount = 0;
  let skipped = 0;
  for (const row of rows.slice(headerRow + 1)) {
    if (row.every((cell) => text(cell) === '')) continue;
    rowCount += 1;
    if (rowCount > COST_LINK_FILE_MAX_ROWS) {
      return { ok: false, message: COST_LINK_FILE_TOO_MANY_ROWS_MESSAGE };
    }
    const itemCode = text(row[itemColumn]);
    const materialCode = text(row[materialColumn]);
    if (itemCode === '' || materialCode === '') {
      skipped += 1;
      continue;
    }
    pairs.push({ itemCode, materialCode });
  }
  if (pairs.length === 0) return { ok: false, message: COST_LINK_FILE_EMPTY_MESSAGE };
  return { ok: true, pairs, rowCount, skipped };
}
