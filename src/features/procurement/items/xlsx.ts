import 'server-only';

import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/node';

import type { ItemRowView } from './types';

/**
 * 등록 품목 xlsx (조달이 통합 UI-2). 현재 필터·정렬 결과 그대로, 금액은 **원**(정수, 천 단위 구분 서식) — 표의 백만원 표기(D-3)와 달리
 * 파일은 원 단위 원값을 준다. 날짜는 'YYYY-MM-DD' 문자열(시간대 변환 없음). 값이 없으면 빈 칸.
 */
export const ITEM_XLSX_HEADERS = [
  '등록일자',
  '제품',
  '세부분류',
  '제조사',
  '물품식별번호',
  '품목명',
  '계약단가 (원)',
] as const;

const WIDTHS = [12, 10, 18, 24, 16, 48, 16];

/** 상한(10,000건)을 넘어 잘렸을 때 파일 맨 아래 안내 줄 */
export function truncatedNote(limit: number): string {
  return `※ 최대 ${limit.toLocaleString('ko-KR')}건까지만 내려받았습니다. 조건을 좁혀 다시 내려받으세요.`;
}

const text = (value: string | null) => (value ? { type: String, value } : null);

export function itemSheetData(
  rows: readonly ItemRowView[],
  options: { truncated: boolean; limit: number },
): SheetData {
  const header: Row = ITEM_XLSX_HEADERS.map((value) => ({ value, fontWeight: 'bold' as const }));
  const body: Row[] = rows.map((row) => [
    text(row.registeredOn),
    text(row.product),
    text(row.detailCategory),
    text(row.manufacturer),
    text(row.itemId),
    text(row.itemName),
    row.unitPrice === null ? null : { type: Number, value: row.unitPrice, format: '#,##0' },
  ]);
  const data: SheetData = [header, ...body];
  if (options.truncated) data.push([], [{ type: String, value: truncatedNote(options.limit) }]);
  return data;
}

export async function itemsXlsxBuffer(
  rows: readonly ItemRowView[],
  options: { truncated: boolean; limit: number },
): Promise<Buffer> {
  return writeXlsxFile(itemSheetData(rows, options), {
    sheet: '등록 품목',
    columns: WIDTHS.map((width) => ({ width })),
    stickyRowsCount: 1,
  }).toBuffer();
}
