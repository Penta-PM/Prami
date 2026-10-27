import { param, sql, type SQL } from 'drizzle-orm';

import {
  PROCUREMENT_TABLES,
  quoteIdent,
  type ProcurementTableName,
  type SourceValue,
} from './tables';

/** 열 이름 목록 SQL (`"a", "b"`) */
export function columnList(table: ProcurementTableName): SQL {
  return sql.raw(PROCUREMENT_TABLES[table].columns.map(([name]) => quoteIdent(name)).join(', '));
}

/** 대상 테이블 (`procurement."items"`) */
export function targetTable(table: ProcurementTableName): SQL {
  return sql.raw(`procurement.${quoteIdent(table)}`);
}

/**
 * 원본 행 → 타입이 붙은 SELECT (`select s."id"::bigint as "id", … from unnest($1::text[], …) as s(…)`).
 * 열마다 text[] 파라미터 하나 — 행 수와 무관하게 파라미터 수는 열 수. 적재(INSERT … SELECT)와
 * 검증(원본 쪽 건수·합계·해시)이 같은 캐스트를 거치므로 두 쪽 표현이 같다.
 */
export function typedSelect(table: ProcurementTableName, rows: readonly SourceValue[][]): SQL {
  const columns = PROCUREMENT_TABLES[table].columns;
  const casts = sql.raw(
    columns
      .map(([name, type]) => `s.${quoteIdent(name)}::${type} as ${quoteIdent(name)}`)
      .join(', '),
  );
  const arrays = columns.map(
    (_, index) => sql`${param(rows.map((row) => row[index] ?? null))}::text[]`,
  );
  return sql`select ${casts} from unnest(${sql.join(arrays, sql`, `)}) as s(${columnList(table)})`;
}

/** 원본 행을 표처럼 쓰는 하위 질의 (`(select …) as "items"`) */
export function sourceRelation(table: ProcurementTableName, rows: readonly SourceValue[][]): SQL {
  return sql`(${typedSelect(table, rows)}) as ${sql.raw(quoteIdent(table))}`;
}

/** 대상 테이블을 같은 별칭으로 (`procurement."items" as "items"`) */
export function targetRelation(table: ProcurementTableName): SQL {
  return sql`${targetTable(table)} as ${sql.raw(quoteIdent(table))}`;
}
