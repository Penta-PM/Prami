import type { Cell } from './cells';

/** 헤더 행 탐색 범위: 상위 5행 (§4.4.1) */
export const HEADER_SCAN_ROWS = 5;

export type HeaderMatch =
  | {
      ok: true;
      /** 헤더 행 (0-base) */
      rowIndex: number;
      /** 헤더명 → 열 번호 */
      columns: Map<string, number>;
      /** 정의에 없는 추가 컬럼 (무시하되 경고) */
      extras: { header: string; column: number }[];
    }
  | { ok: false; missing: string[]; bestRowIndex: number };

function headerCells(row: readonly Cell[]): string[] {
  return row.map((cell) =>
    typeof cell === 'string' ? cell.trim() : cell == null ? '' : String(cell),
  );
}

/**
 * 상위 5행 중 필수 헤더가 모두 있는 첫 행을 헤더로 본다. 비교는 공백 trim 후 정확 일치.
 * 없으면 가장 많이 맞은 행 기준의 누락 헤더 목록을 돌려준다 (배치 failed 메시지용).
 */
export function detectHeader(
  rows: readonly (readonly Cell[])[],
  required: readonly string[],
  known: readonly string[],
): HeaderMatch {
  let best = { rowIndex: 0, missing: [...required] };
  for (let rowIndex = 0; rowIndex < Math.min(HEADER_SCAN_ROWS, rows.length); rowIndex += 1) {
    const cells = headerCells(rows[rowIndex] ?? []);
    const missing = required.filter((header) => !cells.includes(header));
    if (missing.length === 0) {
      const columns = new Map<string, number>();
      const extras: { header: string; column: number }[] = [];
      cells.forEach((header, column) => {
        if (header === '') return;
        if (known.includes(header) && !columns.has(header)) columns.set(header, column);
        else extras.push({ header, column });
      });
      return { ok: true, rowIndex, columns, extras };
    }
    if (missing.length < best.missing.length) best = { rowIndex, missing };
  }
  return { ok: false, missing: best.missing, bestRowIndex: best.rowIndex };
}
