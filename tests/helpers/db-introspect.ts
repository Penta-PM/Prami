import { sql } from 'drizzle-orm';

import type { Db } from '@/db';

import type { DbColumnShape } from '../fixtures/sales-prices-columns';

type InformationSchemaColumn = {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  ordinal_position: number;
};

/** 드라이버별 execute 결과(rows 배열)를 공통으로 꺼낸다 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) throw new Error('execute 결과에 rows 가 없습니다');
  return rows as T[];
}

/** information_schema.columns 를 ordinal 순으로 읽어 스냅샷 형태로 변환한다 */
export async function describeColumns(db: Db, table: string): Promise<DbColumnShape[]> {
  const result = await db.execute(sql`
    select column_name, data_type, is_nullable, character_maximum_length,
           numeric_precision, numeric_scale, ordinal_position
    from information_schema.columns
    where table_schema = 'public' and table_name = ${table}
    order by ordinal_position
  `);
  return rowsOf<InformationSchemaColumn>(result).map((row) => ({
    column: row.column_name,
    dataType: row.data_type,
    nullable: row.is_nullable === 'YES',
    ...(row.character_maximum_length != null && { charLength: row.character_maximum_length }),
    ...(row.data_type === 'numeric' &&
      row.numeric_precision != null && {
        precision: row.numeric_precision,
        scale: row.numeric_scale ?? 0,
      }),
  }));
}

export async function listTables(db: Db): Promise<string[]> {
  const result = await db.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
      and table_name not like '\_\_drizzle%'
    order by table_name
  `);
  return rowsOf<{ table_name: string }>(result).map((row) => row.table_name);
}

export async function listExtensions(db: Db): Promise<string[]> {
  const result = await db.execute(sql`select extname from pg_extension order by extname`);
  return rowsOf<{ extname: string }>(result).map((row) => row.extname);
}

export async function listIndexes(db: Db, table: string): Promise<string[]> {
  const result = await db.execute(
    sql`select indexname from pg_indexes where schemaname = 'public' and tablename = ${table} order by indexname`,
  );
  return rowsOf<{ indexname: string }>(result).map((row) => row.indexname);
}

export async function countRows(db: Db, table: string): Promise<number> {
  const result = await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  return rowsOf<{ n: number }>(result)[0]?.n ?? 0;
}
