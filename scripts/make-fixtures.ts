/**
 * `pnpm fixtures` — 임포트 테스트 픽스처 생성 (§5 scripts/make-fixtures.ts, §6 PR-3).
 * 원본 `병합_가격_raw.xlsx`(SOURCE_XLSX, 읽기 전용)에서 계열 단위로 200행을 뽑고, 오류·품목조회 픽스처를 만든다.
 * 품목조회는 39컬럼(PRAMI-003) — scripts/fixtures-items.ts.
 * 출력: tests/fixtures/imports/*.xlsx (커밋 대상). 원본이 바뀌지 않는 한 결과는 결정적이다.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node';

import { writeReducedRealItems, writeSyntheticItems } from './fixtures-items';

const SOURCE =
  process.env.SOURCE_XLSX ??
  'C:/Users/USER/orca/workspaces/Prami/_inputs/PRAMI-001/병합_가격_raw.xlsx';
const OUT_DIR = path.resolve(process.cwd(), 'tests/fixtures/imports');
/** 품목조회 원본 5파일 (PRAMI-003). PRAMI_INPUTS_DIR 아래 PRAMI-003/ */
const ITEM_SOURCE_DIR = path.join(
  process.env.PRAMI_INPUTS_DIR ?? 'C:/Users/USER/orca/workspaces/Prami/_inputs',
  'PRAMI-003',
);
const TARGET_ROWS = 200;

type Row = (string | number | boolean | null)[];

/** 스펙 예시 계열 + 단가유형 NULL + 거래처별 행을 반드시 포함한다 */
const MUST_INCLUDE = (row: Row) =>
  row[2] === 'P2002030005' || row[2] === 'P10100015' || row[6] === null || row[17] !== 0;

const seriesKey = (row: Row) => [row[2], row[6] ?? '', row[7], row[8], row[17]].join('|');

function pickSeriesRows(rows: Row[]): Row[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(seriesKey(row), [...(groups.get(seriesKey(row)) ?? []), row]);
  const ordered = [...groups.values()];
  const required = ordered.filter((group) => group.some(MUST_INCLUDE));
  const multi = ordered.filter((group) => !required.includes(group) && group.length > 1);
  const single = ordered.filter((group) => !required.includes(group) && group.length === 1);
  const picked: Row[] = [];
  for (const group of [...required, ...multi]) {
    if (picked.length + group.length <= TARGET_ROWS - 20) picked.push(...group);
  }
  for (const group of single) if (picked.length < TARGET_ROWS) picked.push(...group);
  return picked.sort((a, b) => Number(a[0]) - Number(b[0]));
}

async function write(name: string, data: SheetData, sheet: string) {
  await writeXlsxFile(data, { sheet }).toFile(path.join(OUT_DIR, name));
  console.log(`[fixtures] ${name} (${data.length - 1}행)`);
}

const cells = (rows: Row[]): SheetData => rows.map((row) => row.map((value) => value as Cell));

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const [sheet] = await readXlsxFile(readFileSync(SOURCE));
  if (!sheet) throw new Error('원본 시트가 없습니다');
  const [header, ...rows] = sheet.data as Row[];
  if (!header) throw new Error('원본 헤더가 없습니다');
  const sample = pickSeriesRows(rows);
  await write('sales-200.xlsx', cells([header, ...sample]), 'RAW');

  const coreIndex = header.indexOf('단가(1코어)');
  await write(
    'sales-header-missing.xlsx',
    cells([header, ...sample].map((row) => row.filter((_, index) => index !== coreIndex))),
    'RAW',
  );

  const broken = sample.map((row) => [...row]);
  broken[2]![12] = '2024-13-45'; // 잘못된 날짜 → 적용시작일 오류
  broken[4]![10] = -1000; // 음수 단가 → 단가 오류
  broken.push([...sample[0]!]); // 같은 계열·적용시작일 중복
  await write('sales-row-errors.xlsx', cells([header, ...broken]), 'RAW');

  await writeSyntheticItems(OUT_DIR, sample, ITEM_SOURCE_DIR);
  await writeReducedRealItems(ITEM_SOURCE_DIR, path.resolve(process.cwd(), 'tests/fixtures/items'));

  const costHeader: Row = [
    '자재번호',
    '자재명',
    '규격',
    '단위',
    '단가유형',
    '단가구분',
    '화폐',
    '단가',
    '적용시작일',
    '최종여부',
    '비고',
    '전체고객적용여부',
  ];
  const costs: Row[] = [
    [
      'W10100016',
      'WAPPLES-100 T4',
      null,
      'EA',
      '표준구매원가',
      '일반',
      'KRW',
      984000,
      '2024-01-01',
      false,
      null,
      false,
    ],
    [
      'W10100016',
      'WAPPLES-100 T4',
      null,
      'EA',
      '표준구매원가',
      '일반',
      'KRW',
      1010000,
      '2025-01-01',
      true,
      '중복',
      false,
    ],
    [
      'W20100001',
      'D.AMO 서버',
      null,
      'EA',
      '표준구매원가',
      '일반',
      'KRW',
      500000,
      '2025-03-01',
      true,
      null,
      true,
    ],
  ];
  await write(
    'costs-sample.xlsx',
    cells([['구매단가등록(계약)_pts'], costHeader, ...costs]),
    'Sheet1',
  );

  // 원본과 같은 모양의 중복: 완전 동일 1쌍 + 값이 다른 1쌍 (Main 결정 B 회귀용)
  const isign = (cost: number, from: string, final: boolean): Row => [
    'W40100002',
    'iSIGN 서버',
    null,
    'EA',
    '표준구매원가',
    '일반',
    'KRW',
    cost,
    from,
    final,
    null,
    false,
  ];
  const dupCosts: Row[] = [
    ...costs,
    [...costs[0]!],
    isign(300000, '2025-01-01', false),
    isign(280000, '2025-01-01', false),
    isign(310000, '2026-01-01', true),
  ];
  await write(
    'costs-dup.xlsx',
    cells([['구매단가등록(계약)_pts'], costHeader, ...dupCosts]),
    'Sheet1',
  );

  const partCodes = [...new Set(sample.map((row) => row[2] as string))];
  await write(
    'parts-sample.xlsx',
    cells([
      ['모델명', '모델품번', '파츠품번'],
      ['모델 A', partCodes[0]!, partCodes[1]!],
      ['모델 A', partCodes[0]!, partCodes[2]!],
      ['모델 B', partCodes[3]!, 'NOPE-0000'],
    ]),
    'Sheet1',
  );
}

main().catch((error: unknown) => {
  console.error('[fixtures] 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
