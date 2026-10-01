/**
 * 품목조회 테스트 픽스처 (PRAMI-003 §9) — `pnpm fixtures` 가 호출한다.
 * ① 합성 items-v1/v2 (판매단가 200행 표본의 품번으로 만든 39컬럼 파일) ② 실데이터 축소 픽스처 tests/fixtures/items/*.xlsx
 *    (제품군별 대표 + 예외표 전 품번 + 경계 케이스). 개인정보 컬럼은 **가짜 값**, 비고는 합성 문구로 바꾼다 — 실제 이름·자유 텍스트는 커밋하지 않는다.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node';

import { ITEM_KIND_OVERRIDES } from '../src/lib/constants/item-kind-rules';
import { ITEM_EXCLUDED_HEADERS, ITEM_HEADER_TREATMENTS } from '../src/server/imports/schemas/items';

type Value = string | number | boolean | null;
type Row = Value[];

export const ITEM_HEADERS: string[] = ITEM_HEADER_TREATMENTS.map(([header]) => header);

/** 정규화 제품군 → ERP 대분류 원문 */
export const FAMILY_TO_ERP_MAJOR: Record<string, string> = {
  WAPPLES: 'WAPPLES',
  'D.AMO': "D'Amo",
  iSIGN: 'iSIGN+',
  'iSIGN PKI': 'iSIGN+ PKI',
  Cloudbric: 'Cloudbric',
};

const FAKE_PEOPLE = ['가짜등록자가', '가짜등록자나', '가짜등록자다'];

/** 헤더 → 값 맵을 39컬럼 순서 행으로 (제외 컬럼은 가짜 값) */
export function itemRow(values: Partial<Record<string, Value>>, seed: number): Row {
  return ITEM_HEADERS.map((header) => {
    if (ITEM_EXCLUDED_HEADERS.includes(header)) return FAKE_PEOPLE[seed % FAKE_PEOPLE.length]!;
    if (['옵션품목', '세트품목', '모델상속', 'BOM등록', 'LOT관리', 'Serial관리'].includes(header)) {
      return values[header] ?? 'FALSE';
    }
    return values[header] ?? null;
  });
}

const cells = (rows: Row[]): SheetData => rows.map((row) => row.map((value) => value as Cell));

async function write(file: string, rows: Row[], sheet: string) {
  await writeXlsxFile(cells(rows), { sheet }).toFile(file);
  console.log(`[fixtures] ${path.relative(process.cwd(), file)} (${rows.length - 1}행)`);
}

type RealCategory = { major: string; mid: string; minor: string };

/**
 * E2E 계산기 STEP5(결합형) 용 합성 분류 — 판매단가 200행 표본에는 결합형(D.AMO 번들) 품번이 없어서, 운영중 정상판매 최신 행이 있는
 * WAPPLES 품번 1개를 `번들용 패키지`(K5 → 결합형)로 둔다. 실데이터 분류가 아니다(테스트 픽스처 한정).
 */
const SYNTHETIC_BUNDLE_CODE = 'P1006030015';

/** 실파일의 품번 → (대,중,소)분류 원문 (합성 품목의 분류를 실데이터로 맞춰 종류 판정을 현실적으로) */
export async function readRealCategories(sourceDir: string): Promise<Map<string, RealCategory>> {
  const map = new Map<string, RealCategory>();
  if (!existsSync(sourceDir)) return map;
  for (const name of readdirSync(sourceDir).filter((file) => file.endsWith('.xlsx'))) {
    const [sheet] = await readXlsxFile(readFileSync(path.join(sourceDir, name)));
    const data = (sheet?.data ?? []) as Row[];
    const header = (data[1] ?? []).map((cell) => String(cell ?? '').trim());
    const at = (column: string) => header.indexOf(column);
    for (const row of data.slice(2)) {
      map.set(String(row[at('품번')] ?? ''), {
        major: String(row[at('품목대분류')] ?? ''),
        mid: String(row[at('품목중분류')] ?? ''),
        minor: String(row[at('품목소분류')] ?? ''),
      });
    }
  }
  return map;
}

/**
 * 합성 품목: 판매단가 표본 품번 중 앞 3개는 마스터에서 빼 stub, 4·5번째 폐기, 6번째 임시, 나머지 사용.
 * 분류는 실데이터(있으면) 원문, 없으면 `<제품군> 라인업`(9번째마다 Parts). 상태는 위 규칙의 합성 값(테스트 결정성).
 */
function syntheticItems(sales: Row[], real: Map<string, RealCategory>): Row[] {
  const codes = [...new Map(sales.map((row) => [row[2] as string, row])).values()];
  return codes.slice(3).map((row, index) => {
    const status = index < 2 ? '폐기' : index === 2 ? '임시' : '사용';
    const family = String(row[1]);
    const category = real.get(row[2] as string);
    return itemRow(
      {
        품명: (row[3] as string) ?? null,
        품번: row[2] as string,
        기준단위: 'EA',
        '품목 상태': status,
        품목대분류: category?.major ?? FAMILY_TO_ERP_MAJOR[family] ?? family,
        품목중분류:
          row[2] === SYNTHETIC_BUNDLE_CODE
            ? '번들용 패키지'
            : (category?.mid ?? (index % 9 === 0 ? 'Parts' : `${family} 라인업`)),
        품목소분류: category?.minor ?? `${family}-${index % 4}`,
        등록일: '2024-01-02',
        최종수정일: index % 5 === 0 ? null : '2025-03-04',
        비고: `비고 ${index}`,
        부가세구분: '과세',
      },
      index,
    );
  });
}

export async function writeSyntheticItems(outDir: string, sales: Row[], sourceDir: string) {
  const rows = syntheticItems(sales, await readRealCategories(sourceDir));
  // ERP 원본처럼 1행 제목 + 2행 헤더
  await write(
    path.join(outDir, 'items-v1.xlsx'),
    [['품목조회'], ITEM_HEADERS, ...rows],
    '품목조회',
  );
  const statusIndex = ITEM_HEADERS.indexOf('품목 상태');
  const v2 = rows.map((row, index) =>
    index === 5 ? row.map((value, i) => (i === statusIndex ? '폐기' : value)) : row,
  );
  await write(path.join(outDir, 'items-v2.xlsx'), [ITEM_HEADERS, ...v2], 'Sheet1');
}

/** 실파일 1개 → 축소 행: (중,소) 조합별 첫 행 + 예외표 품번 + NBSP 품명 + 한글 품번 */
function reduceRealRows(rows: Row[], header: string[]): Row[] {
  const at = (name: string) => header.indexOf(name);
  const seen = new Set<string>();
  const picked: Row[] = [];
  for (const row of rows) {
    const code = String(row[at('품번')] ?? '');
    const combo = `${row[at('품목중분류')]}|${row[at('품목소분류')]}`;
    const name = String(row[at('품명')] ?? '');
    const keep =
      code in ITEM_KIND_OVERRIDES || name.includes(' ') || /[가-힣]/.test(code) || !seen.has(combo);
    seen.add(combo);
    if (keep) picked.push(row);
  }
  return picked;
}

function sanitize(row: Row, header: string[], seed: number): Row {
  const values = Object.fromEntries(header.map((name, i) => [name, row[i] ?? null]));
  if (values['비고'] !== null && values['비고'] !== '') values['비고'] = '비고 예시';
  return itemRow(values, seed);
}

/** 실데이터 축소 픽스처 — 원본 디렉터리가 없으면 건너뛴다 */
export async function writeReducedRealItems(sourceDir: string, outDir: string) {
  if (!existsSync(sourceDir)) {
    console.log(`[fixtures] 품목 원본 없음 — 축소 픽스처 건너뜀 (${sourceDir})`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  for (const name of readdirSync(sourceDir)
    .filter((file) => file.endsWith('.xlsx'))
    .sort()) {
    const [sheet] = await readXlsxFile(readFileSync(path.join(sourceDir, name)));
    const data = (sheet?.data ?? []) as Row[];
    const header = (data[1] ?? []).map((cell) => String(cell ?? '').trim());
    const rows = reduceRealRows(data.slice(2), header).map((row, i) => sanitize(row, header, i));
    const out = name
      .replace(/[^A-Za-z]+/g, '-')
      .replace(/-+xlsx$/i, '')
      .replace(/^-|-$/g, '');
    await write(
      path.join(outDir, `${out.toLowerCase()}.xlsx`),
      [['품목조회'], ITEM_HEADERS, ...rows],
      'Sheet1',
    );
  }
}
