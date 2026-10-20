import { sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { queryRows, type Executor } from '@/server/imports/sql-rows';

import bundledJournal from '../../../drizzle/meta/_journal.json';

/**
 * 스키마 버전 검사 (PRAMI-003 §4.3.6, AC-326). 번들에 포함된 drizzle 저널의 마지막 항목과
 * DB `drizzle.__drizzle_migrations` 의 최신 항목(created_at = 저널 `when`)을 비교한다.
 * - behind: DB 에 미적용 마이그레이션이 있음 → 헬스 503, 오류 로그 `db.schema_behind`
 * - ahead: DB 가 앱보다 앞섬(롤백한 구버전 앱) → 경고 `db.schema_ahead`, 헬스 200 (expand/contract 전제)
 */
export type SchemaState = 'ok' | 'behind' | 'ahead';

export type MigrationJournal = {
  entries: ReadonlyArray<{ idx: number; when: number; tag: string }>;
};

export const BUNDLED_JOURNAL: MigrationJournal = bundledJournal;

export function latestJournalEntry(journal: MigrationJournal) {
  return journal.entries.reduce<MigrationJournal['entries'][number] | null>(
    (latest, entry) => (latest === null || entry.when > latest.when ? entry : latest),
    null,
  );
}

/** DB 최신 적용 시각보다 뒤인 저널 항목 = 미적용 마이그레이션(파일 이름 순). DB 가 비었으면 전부 */
export function pendingMigrations(journal: MigrationJournal, dbLatest: number | null): string[] {
  return journal.entries
    .filter((entry) => dbLatest === null || entry.when > dbLatest)
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => entry.tag);
}

export function compareSchema(journalLatest: number | null, dbLatest: number | null): SchemaState {
  if (journalLatest === null) return dbLatest === null ? 'ok' : 'ahead';
  if (dbLatest === null || dbLatest < journalLatest) return 'behind';
  return dbLatest > journalLatest ? 'ahead' : 'ok';
}

/** DB 최신 마이그레이션 시각. 마이그레이션 테이블이 없으면(빈 DB) null */
export async function latestAppliedMigration(db: Executor): Promise<number | null> {
  const [exists] = await queryRows<{ present: boolean }>(
    db,
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
  );
  if (!exists?.present) return null;
  const [row] = await queryRows<{ latest: string | number | null }>(
    db,
    sql`select max(created_at) as latest from drizzle.__drizzle_migrations`,
  );
  return row?.latest === null || row?.latest === undefined ? null : Number(row.latest);
}

export async function readSchemaState(
  db: Db,
  journal: MigrationJournal = BUNDLED_JOURNAL,
): Promise<SchemaState> {
  return compareSchema(latestJournalEntry(journal)?.when ?? null, await latestAppliedMigration(db));
}
