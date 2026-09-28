import readXlsxFile from 'read-excel-file/node';

import type { Cell } from './cells';
import { inspectZip, ZipGuardError } from './zip-guard';

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

/** 파싱 제한 시간 — 비정상 입력으로 파서가 settle 하지 않아도 요청은 이 시간 안에 오류로 끝난다 */
export const PARSE_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new WorkbookReadError(
            '엑셀 파일을 제한 시간 안에 읽지 못했습니다. 파일을 다시 저장해 올려 주세요',
          ),
        ),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * xlsx 전체 시트를 읽는다. 손상·비 xlsx 파일은 WorkbookReadError.
 * 파서 호출 전에 zip 구조(끝 잔여 바이트·압축 해제 크기)를 검사하고, 파싱에는 제한 시간을 둔다 (PR-3 QA).
 */
export async function readWorkbook(
  buffer: Buffer,
  timeoutMs: number = PARSE_TIMEOUT_MS,
): Promise<Worksheet[]> {
  try {
    inspectZip(buffer);
  } catch (error) {
    if (error instanceof ZipGuardError) throw new WorkbookReadError(error.message);
    throw error;
  }
  try {
    const sheets = await withTimeout(readXlsxFile(buffer), timeoutMs);
    return sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data as Cell[][] }));
  } catch (error) {
    if (error instanceof WorkbookReadError) throw error;
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
