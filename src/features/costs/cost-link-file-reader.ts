import {
  COST_LINK_FILE_FORMAT_MESSAGE,
  COST_LINK_FILE_MAX_BYTES,
  COST_LINK_FILE_TOO_LARGE_MESSAGE,
  extractCostLinkPairs,
  type CostLinkCell,
  type CostLinkFileResult,
} from '@/lib/imports/cost-link-file';

/**
 * 품목-원가 매칭 파일을 **브라우저에서** 읽는다 (스펙 erp-upload-guide §6.2-2). 파일은 서버로 보내지 않고,
 * {품번, 원자재품번} 쌍만 돌려준다. 파서(read-excel-file 브라우저 빌드)는 업로드할 때만 동적으로 불러온다.
 * 시트는 첫 번째 것만 읽는다.
 */
export async function readCostLinkFile(file: Blob): Promise<CostLinkFileResult> {
  if (file.size > COST_LINK_FILE_MAX_BYTES) {
    return { ok: false, message: COST_LINK_FILE_TOO_LARGE_MESSAGE };
  }
  let rows: CostLinkCell[][];
  try {
    const { readSheet } = await import('read-excel-file/browser');
    rows = (await readSheet(file)) as CostLinkCell[][];
  } catch {
    // 손상·비 xlsx 파일 — 내용·파일명은 어디에도 남기지 않는다
    return { ok: false, message: COST_LINK_FILE_FORMAT_MESSAGE };
  }
  return extractCostLinkPairs(rows);
}
