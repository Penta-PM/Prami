import { readFileSync } from 'node:fs';
import path from 'node:path';

import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node';

import { XLSX_MIME } from './imports';

/**
 * 품목조회 축소 픽스처(tests/fixtures/items — 실데이터 축소, 개인정보 컬럼은 가짜 값) 읽기·변형 쓰기 (PRAMI-003 §9).
 */
export const ITEM_FIXTURE_DIR = path.resolve(process.cwd(), 'tests/fixtures/items');
export const ITEM_FIXTURES = ['wapples', 'd-amo', 'isign', 'isgin-pki', 'cloudbric'] as const;

export type ItemSheet = { title: unknown[]; header: string[]; rows: unknown[][] };

export async function readItemFixture(name: string): Promise<ItemSheet> {
  const [sheet] = await readXlsxFile(readFileSync(path.join(ITEM_FIXTURE_DIR, `${name}.xlsx`)));
  const data = (sheet?.data ?? []) as unknown[][];
  return {
    title: data[0] ?? [],
    header: (data[1] ?? []).map((cell) => String(cell ?? '').trim()),
    rows: data.slice(2),
  };
}

/** 1행 제목 + 2행 헤더 + 데이터 → xlsx 버퍼 */
export async function itemXlsx(sheet: Omit<ItemSheet, 'title'>): Promise<Buffer> {
  const data: SheetData = [['품목조회'], sheet.header, ...sheet.rows].map((row) =>
    (row as unknown[]).map((value) => (value ?? null) as Cell),
  );
  return writeXlsxFile(data, { sheet: 'Sheet1' }).toBuffer();
}

export function itemInput(fileName: string, bytes: Buffer) {
  return { fileName, mimeType: XLSX_MIME, bytes };
}

export async function fixtureInputs(names: readonly string[] = ITEM_FIXTURES) {
  return names.map((name) =>
    itemInput(`${name}.xlsx`, readFileSync(path.join(ITEM_FIXTURE_DIR, `${name}.xlsx`))),
  );
}

/** 헤더 이름으로 셀 값을 바꾼 행 */
export function withCell(sheet: ItemSheet, row: unknown[], header: string, value: unknown) {
  const copy = [...row];
  copy[sheet.header.indexOf(header)] = value;
  return copy;
}

export function cellOf(sheet: ItemSheet, row: unknown[], header: string): unknown {
  return row[sheet.header.indexOf(header)];
}
