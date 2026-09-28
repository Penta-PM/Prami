import readXlsxFile from 'read-excel-file/node';

import type { Cell } from './cells';

/** 업로드 파일 제한 (§4.4.1) */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const XLSX_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // 일부 브라우저·OS 는 xlsx 를 일반 바이너리로 보낸다
  'application/octet-stream',
  '',
] as const;

export type Worksheet = { name: string; rows: Cell[][] };

export class WorkbookReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookReadError';
  }
}

/** xlsx 전체 시트를 읽는다. 손상·비 xlsx 파일은 WorkbookReadError */
export async function readWorkbook(buffer: Buffer): Promise<Worksheet[]> {
  try {
    const sheets = await readXlsxFile(buffer);
    return sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data as Cell[][] }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new WorkbookReadError(`엑셀(.xlsx) 파일을 읽을 수 없습니다: ${detail}`);
  }
}

/** 선호 시트명(대소문자 무시)이 있으면 그 시트, 없으면 첫 시트 (§4.4.1: sales 는 'RAW' 우선) */
export function pickSheet(sheets: readonly Worksheet[], preferred: readonly string[]): Worksheet {
  const wanted = preferred.map((name) => name.toLowerCase());
  const match = sheets.find((sheet) => wanted.includes(sheet.name.trim().toLowerCase()));
  const sheet = match ?? sheets[0];
  if (!sheet) throw new WorkbookReadError('시트가 없습니다');
  return sheet;
}
