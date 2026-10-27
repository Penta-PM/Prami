import { sql } from 'drizzle-orm';

import { queryCount, queryRows, type Executor } from '@/server/imports/sql-rows';

import { sourceRelation, targetTable, columnList, typedSelect } from './sql';
import {
  PROCUREMENT_TABLE_NAMES,
  PROCUREMENT_TABLES,
  quoteIdent,
  type ProcurementTableName,
  type SourceData,
} from './tables';

/**
 * 조달이 → Prami procurement 스키마 적재 (DB-3). 호출자가 한 트랜잭션으로 감싼다(withTransaction).
 * - 대상 8개 표 중 하나라도 행이 있으면 거부 — `replace` 만 TRUNCATE … RESTART IDENTITY CASCADE 후 재적재
 * - 적재: 열마다 text[] 파라미터 하나인 `INSERT … SELECT … FROM unnest(…)` 배치(COPY 대체 — pg-copy-streams 의존성 없음,
 *   PGlite·node-postgres·neon 공통). 원본 id 를 그대로 넣는다
 * - items 트리거(updated_at = now()·product_group 계산)는 적재 동안 끈다 — 원본 updated_at·product_group 보존
 * - 끝에 bigserial 시퀀스 setval(max(id)) — 빈 표는 다음 값 1
 * - dryRun: 쓰지 않고 원본 건수·대상 건수·캐스트 검증(원본 전 행을 대상 타입으로 SELECT)만
 */
export type ImportOptions = { replace: boolean; dryRun: boolean; batchSize?: number };

export type ImportTableResult = {
  table: ProcurementTableName;
  source: number;
  targetBefore: number;
  targetAfter: number | null;
};

export type ImportResult = {
  tables: ImportTableResult[];
  /** 대상이 비어 있지 않아 적재할 수 없음(dryRun 에서만 — 실제 적재는 throw) */
  blocked: boolean;
  dryRun: boolean;
  replaced: boolean;
};

export const NON_EMPTY_TARGET_MESSAGE =
  '대상 procurement 표가 비어 있지 않습니다 — 다시 적재하려면 --replace 를 지정하세요';

const DEFAULT_BATCH = 1000;

export async function assertProcurementSchema(db: Executor): Promise<void> {
  const rows = await queryRows<{ ok: boolean }>(
    db,
    sql`select to_regclass('procurement.items') is not null as ok`,
  );
  if (!rows[0]?.ok) {
    throw new Error(
      'procurement 스키마가 없습니다 — 0012 마이그레이션(db:migrate)을 먼저 적용하세요',
    );
  }
}

export async function targetCounts(db: Executor): Promise<Record<ProcurementTableName, number>> {
  const counts: Partial<Record<ProcurementTableName, number>> = {};
  for (const table of PROCUREMENT_TABLE_NAMES) {
    counts[table] = await queryCount(db, sql`select count(*)::int as n from ${targetTable(table)}`);
  }
  return counts as Record<ProcurementTableName, number>;
}

/** 원본 전 행을 대상 타입으로 캐스트해 본다(쓰지 않음, CHECK·UNIQUE 같은 제약은 실제 적재에서) — 형식 오류를 적재 전에 잡는다 */
async function castCheck(db: Executor, data: SourceData): Promise<void> {
  for (const table of PROCUREMENT_TABLE_NAMES) {
    try {
      await queryCount(
        db,
        // count(*) 만 쓰면 플래너가 열 캐스트를 계산하지 않는다 — 행 텍스트를 만들어 모든 칸을 실제로 변환시킨다
        sql`select count(*)::int as n from ${sourceRelation(table, data[table])}
            where ${sql.raw(quoteIdent(table))}::text is not null`,
      );
    } catch (error) {
      throw new Error(`${table}: 원본 값을 대상 타입으로 변환할 수 없습니다`, { cause: error });
    }
  }
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < rows.length; start += size) out.push(rows.slice(start, start + size));
  return out;
}

async function insertTable(
  db: Executor,
  table: ProcurementTableName,
  data: SourceData,
  batchSize: number,
): Promise<void> {
  for (const batch of chunks(data[table], batchSize)) {
    await db.execute(
      sql`insert into ${targetTable(table)} (${columnList(table)}) ${typedSelect(table, batch)}`,
    );
  }
}

/** bigserial 시퀀스를 max(id) 로 — 빈 표는 setval(1, false)(다음 nextval = 1) */
export async function syncSequences(db: Executor): Promise<void> {
  for (const table of PROCUREMENT_TABLE_NAMES) {
    if (!PROCUREMENT_TABLES[table].serial) continue;
    const qualified = `procurement.${quoteIdent(table)}`;
    await db.execute(
      sql.raw(
        `select setval(pg_get_serial_sequence('${qualified}', 'id'), coalesce(max("id"), 1), max("id") is not null) from ${qualified}`,
      ),
    );
  }
}

export async function importProcurement(
  db: Executor,
  data: SourceData,
  options: ImportOptions,
): Promise<ImportResult> {
  await assertProcurementSchema(db);
  const before = await targetCounts(db);
  const nonEmpty = PROCUREMENT_TABLE_NAMES.some((table) => before[table] > 0);
  const blocked = nonEmpty && !options.replace;
  const summary = (after: Record<ProcurementTableName, number> | null): ImportTableResult[] =>
    PROCUREMENT_TABLE_NAMES.map((table) => ({
      table,
      source: data[table].length,
      targetBefore: before[table],
      targetAfter: after ? after[table] : null,
    }));

  if (options.dryRun) {
    await castCheck(db, data);
    return { tables: summary(null), blocked, dryRun: true, replaced: false };
  }
  if (blocked) throw new Error(NON_EMPTY_TARGET_MESSAGE);

  if (options.replace && nonEmpty) {
    const all = PROCUREMENT_TABLE_NAMES.map((table) => `procurement.${quoteIdent(table)}`).join(
      ', ',
    );
    await db.execute(sql.raw(`truncate table ${all} restart identity cascade`));
  }
  await db.execute(sql`alter table procurement.items disable trigger items_before_write`);
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  for (const table of PROCUREMENT_TABLE_NAMES) await insertTable(db, table, data, batchSize);
  await db.execute(sql`alter table procurement.items enable trigger items_before_write`);
  await syncSequences(db);

  return {
    tables: summary(await targetCounts(db)),
    blocked: false,
    dryRun: false,
    replaced: options.replace && nonEmpty,
  };
}

/** 건수 표(금액 없음) */
export function formatImportResult(result: ImportResult): string {
  const lines = [
    '| 표 | 원본 | 대상(전) | 대상(후) |',
    '| --- | --- | --- | --- |',
    ...result.tables.map(
      (row) => `| ${row.table} | ${row.source} | ${row.targetBefore} | ${row.targetAfter ?? '-'} |`,
    ),
  ];
  if (result.dryRun) {
    lines.push(
      '',
      result.blocked
        ? `dry-run: 쓰지 않음 — ${NON_EMPTY_TARGET_MESSAGE}`
        : 'dry-run: 쓰지 않음 — 원본 값 형식 확인 통과, 적재 가능',
    );
  } else if (result.replaced) {
    lines.push('', '--replace: 기존 행을 비우고 다시 적재했습니다');
  }
  return lines.join('\n');
}
