import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node';

/**
 * 합성 품목-원가 매칭 파일 (erp-upload-guide §6.2-8) — 실제 품목코드·품번 없음. 1행 제목, 2행 헤더, 3행부터 데이터.
 * 실제 파일과 같은 모양의 무시 열(품명·원자재대체품번 등)을 섞어 "두 열만 읽는다"를 확인한다.
 */
export const COST_LINK_TEST_HEADER = [
  '품명',
  '품번',
  '원자재품번(필수)',
  '원자재대체품번',
  '추가자재품번',
];

export async function costLinkXlsx(
  rows: readonly (readonly unknown[])[],
  options: { title?: string | null; header?: readonly string[] } = {},
): Promise<Buffer> {
  const title = options.title === undefined ? '품목조회(추가정보)' : options.title;
  const data: SheetData = [
    ...(title === null ? [] : [[title]]),
    [...(options.header ?? COST_LINK_TEST_HEADER)],
    ...rows.map((row) => [...row]),
  ].map((row) => (row as unknown[]).map((value) => (value ?? null) as Cell));
  return writeXlsxFile(data, { sheet: 'Sheet1' }).toBuffer();
}

/** 품명·품번·원자재품번·대체·추가 순 합성 행 */
export function costLinkRow(itemCode: string | null, materialCode: string | null): unknown[] {
  return [`TEST 품목 ${itemCode ?? '-'}`, itemCode, materialCode, 'TEST-ALT-001', 'TEST-EXTRA-001'];
}
