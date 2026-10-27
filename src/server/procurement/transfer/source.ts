import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import {
  PROCUREMENT_TABLE_NAMES,
  PROCUREMENT_TABLES,
  quoteIdent,
  type ColumnType,
  type ProcurementTableName,
  type SourceData,
  type SourceValue,
} from './tables';

/**
 * 이관 원본 읽기 (DB-3) — CSV 디렉터리(`<표>.csv` 8개) 또는 원본 Postgres(읽기 전용 트랜잭션).
 * 결과는 테이블별 텍스트 행(SourceData). 오류 메시지에는 파일·행·열 위치만 담고 값은 담지 않는다.
 */

/** RFC 4180 CSV → 행 배열. UTF-8 BOM 제거, CRLF·따옴표 안 줄바꿈·`""` 이스케이프 처리, 끝 빈 줄 무시 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < input.length) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (input[i + 1] !== '\n') endRow();
    } else field += ch;
    i += 1;
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

const TRUE_WORDS = new Set(['t', 'true', '1', 'y', 'yes']);
const FALSE_WORDS = new Set(['f', 'false', '0', 'n', 'no']);

/** `["a","b"]`(JSON) → `{"a","b"}`(Postgres 배열 리터럴). 이미 `{..}` 면 그대로 */
function toPgArrayLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  if (!trimmed.startsWith('[')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const parts = parsed.map((item: unknown) =>
    item === null ? 'NULL' : `"${String(item).replace(/[\\"]/g, '\\$&')}"`,
  );
  return `{${parts.join(',')}}`;
}

/**
 * CSV 칸 → Postgres 텍스트 값. 빈 칸 → NULL, bool `t/f`(true/false·1/0·y/n 도) → 't'/'f',
 * 배열 `{..}`(또는 JSON 배열) → 배열 리터럴. 나머지 타입은 그대로 두고 대상 DB 캐스트가 검증한다.
 * 해석할 수 없으면 undefined(호출부가 위치와 함께 오류).
 */
export function normalizeCsvValue(raw: string, type: ColumnType): SourceValue | undefined {
  if (raw === '') return null;
  if (type === 'boolean') {
    const word = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(word)) return 't';
    if (FALSE_WORDS.has(word)) return 'f';
    return undefined;
  }
  if (type === 'text[]') return toPgArrayLiteral(raw);
  return raw;
}

/** 헤더 열 집합이 명세와 정확히 같아야 한다(순서 무관) — 빠진 열에 기본값(now() 등)이 들어가 원본과 달라지는 걸 막는다 */
function columnOrder(table: ProcurementTableName, header: string[]): number[] {
  const spec = PROCUREMENT_TABLES[table].columns.map(([name]) => name);
  const names = header.map((name) => name.trim());
  const missing = spec.filter((name) => !names.includes(name));
  const extra = names.filter((name) => !spec.includes(name));
  if (missing.length > 0 || extra.length > 0 || new Set(names).size !== names.length) {
    throw new Error(
      `${table}.csv 헤더가 명세와 다릅니다 (빠짐: ${missing.join(', ') || '-'} / 모름: ${extra.join(', ') || '-'})`,
    );
  }
  return spec.map((name) => names.indexOf(name));
}

/** CSV 한 표(헤더 포함 텍스트) → 명세 열 순서의 행 */
export function csvTableRows(table: ProcurementTableName, text: string): SourceValue[][] {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error(`${table}.csv 에 헤더가 없습니다`);
  const order = columnOrder(table, header);
  const columns = PROCUREMENT_TABLES[table].columns;
  return body
    .filter((cells) => !(cells.length === 1 && cells[0] === ''))
    .map((cells, index) => {
      const line = index + 2;
      if (cells.length !== header.length) {
        throw new Error(`${table}.csv ${line}행: 칸 수 ${cells.length} ≠ 헤더 ${header.length}`);
      }
      return columns.map(([name, type], position) => {
        const value = normalizeCsvValue(cells[order[position]!]!, type);
        if (value === undefined) {
          throw new Error(`${table}.csv ${line}행 ${name}: ${type} 로 해석할 수 없습니다`);
        }
        return value;
      });
    });
}

/** CSV 디렉터리 → SourceData. 8개 파일(`items.csv` …)이 모두 있어야 한다(행 0개 표도 헤더만 있는 파일) */
export function readCsvSource(dir: string): SourceData {
  const missing = PROCUREMENT_TABLE_NAMES.filter(
    (table) => !existsSync(path.join(dir, `${table}.csv`)),
  );
  if (missing.length > 0) {
    throw new Error(`CSV 파일이 없습니다: ${missing.map((t) => `${t}.csv`).join(', ')}`);
  }
  return Object.fromEntries(
    PROCUREMENT_TABLE_NAMES.map((table) => [
      table,
      csvTableRows(table, readFileSync(path.join(dir, `${table}.csv`), 'utf8')),
    ]),
  ) as SourceData;
}

/** 원본 Postgres 가 돌려주는 최소 클라이언트 모양 (node-postgres Client) */
export type SourceClient = {
  query: (config: { text: string; rowMode: 'array' }) => Promise<{ rows: SourceValue[][] }>;
};

/**
 * 원본 DB → SourceData. 읽기 전용·REPEATABLE READ 한 트랜잭션(일관된 스냅샷)에서 열마다 `::text` 로 읽는다.
 * 쓰기 문은 보내지 않는다(트랜잭션도 READ ONLY 라 실수로 써도 DB 가 거부).
 */
export async function readDbSourceWith(client: SourceClient, schema: string): Promise<SourceData> {
  await client.query({
    text: 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    rowMode: 'array',
  });
  try {
    const data: Partial<SourceData> = {};
    for (const table of PROCUREMENT_TABLE_NAMES) {
      const spec = PROCUREMENT_TABLES[table];
      const select = spec.columns.map(([name]) => `${quoteIdent(name)}::text`).join(', ');
      const result = await client.query({
        text: `SELECT ${select} FROM ${quoteIdent(schema)}.${quoteIdent(table)} ORDER BY ${quoteIdent(spec.key)}`,
        rowMode: 'array',
      });
      data[table] = result.rows;
    }
    return data as SourceData;
  } finally {
    await client.query({ text: 'ROLLBACK', rowMode: 'array' });
  }
}

/** 접속 문자열로 원본 DB 를 읽는다 (node-postgres 단일 연결) */
export async function readDbSource(connectionString: string, schema: string): Promise<SourceData> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await readDbSourceWith(client as unknown as SourceClient, schema);
  } finally {
    await client.end();
  }
}

export type SourceArgs =
  { kind: 'csv'; dir: string } | { kind: 'db'; url: string; schema: string } | { kind: 'none' };

export const SOURCE_URL_ENV = 'PROCUREMENT_SOURCE_URL';

/** `--csv <dir>` | `--source-db` 공통 해석 (data:verify 도 같은 규칙) */
export function parseSourceArgs(
  args: string[],
  env: Record<string, string | undefined>,
  names: { csv: string; db: string },
): SourceArgs {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const csv = option(names.csv);
  const fromDb = args.includes(names.db);
  if (csv !== undefined && fromDb)
    throw new Error(`${names.csv} 와 ${names.db} 는 함께 쓸 수 없습니다`);
  if (args.includes(names.csv) && (!csv || csv.startsWith('--'))) {
    throw new Error(`${names.csv} 다음에 CSV 디렉터리를 지정하세요`);
  }
  if (csv) return { kind: 'csv', dir: path.resolve(csv) };
  if (fromDb) {
    const url = env[SOURCE_URL_ENV]?.trim();
    if (!url)
      throw new Error(`${names.db} 에는 환경변수 ${SOURCE_URL_ENV}(원본 접속 문자열)가 필요합니다`);
    if (url === env.DATABASE_URL?.trim()) {
      throw new Error(
        `${SOURCE_URL_ENV} 가 대상 DATABASE_URL 과 같습니다 — 원본·대상을 확인하세요`,
      );
    }
    return { kind: 'db', url, schema: option('--source-schema') ?? 'public' };
  }
  return { kind: 'none' };
}

export async function readSource(source: SourceArgs): Promise<SourceData | undefined> {
  if (source.kind === 'csv') return readCsvSource(source.dir);
  if (source.kind === 'db') return readDbSource(source.url, source.schema);
  return undefined;
}

/** 테이블별 행 수 */
export function sourceCounts(data: SourceData): Record<ProcurementTableName, number> {
  return Object.fromEntries(
    PROCUREMENT_TABLE_NAMES.map((table) => [table, data[table].length]),
  ) as Record<ProcurementTableName, number>;
}
