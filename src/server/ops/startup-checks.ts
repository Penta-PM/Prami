import type { Db } from '@/db';
import { isDeployedEnvironment } from '@/env-deploy';
import { logger } from '@/server/log';

import { countFixtureAccounts } from './health';
import {
  BUNDLED_JOURNAL,
  compareSchema,
  latestAppliedMigration,
  latestJournalEntry,
  pendingMigrations,
  type MigrationJournal,
  type SchemaState,
} from './schema-version';

/**
 * 기동 시 1회 점검 (PRAMI-003 §4.3.6·§4.9.3 L4). 실패해도 기동은 계속한다(서버리스 기동 실패 루프 방지) —
 * 결과는 로그로 남기고, 배포 스모크가 `/api/health`(503)로 잡는다.
 * - 스키마 뒤처짐 → error `db.schema_behind`, 앞섬 → warn `db.schema_ahead` (태그 이름만)
 * - 운영·preview(`VERCEL_ENV`)에서 fixture 계정이 있으면 error `db.fixture_accounts_present`(개수만)
 * - 로컬·LAN 개발 서버(배포 환경 아님)에서 뒤처졌으면 미적용 마이그레이션 파일 목록 + `pnpm db:migrate` 안내를 콘솔에 크게
 *   (migration-apply-lan §2-2 — 0008·0009 미적용으로 화면이 죽은 재발 방지). 자동 적용은 하지 않고, 배포 환경 동작은 그대로
 */
export type StartupCheckResult = { schema: SchemaState; fixtureAccounts: number | null };

export async function runStartupChecks(
  db: Db,
  source: Record<string, string | undefined> = process.env,
  journal: MigrationJournal = BUNDLED_JOURNAL,
): Promise<StartupCheckResult> {
  const latest = latestJournalEntry(journal);
  const applied = await latestAppliedMigration(db);
  const schema = compareSchema(latest?.when ?? null, applied);
  if (schema === 'behind') logger.error('db.schema_behind', { expected: latest?.tag ?? null });
  if (schema === 'ahead') logger.warn('db.schema_ahead', { bundled: latest?.tag ?? null });

  if (!isDeployedEnvironment(source)) {
    if (schema === 'behind')
      console.warn(pendingMigrationsBanner(pendingMigrations(journal, applied)));
    return { schema, fixtureAccounts: null };
  }
  const fixtureAccounts = await countFixtureAccounts(db);
  if (fixtureAccounts > 0) logger.error('db.fixture_accounts_present', { count: fixtureAccounts });
  return { schema, fixtureAccounts };
}

/** 개발 서버 콘솔 경고 — 눈에 띄게 테두리 + 파일 목록 + 적용 명령 (DB 주소·비밀값은 넣지 않는다) */
export function pendingMigrationsBanner(tags: readonly string[]): string {
  const line = '='.repeat(72);
  return [
    line,
    `[db] 미적용 마이그레이션 ${tags.length}건 — 이 DB 는 앱 코드보다 스키마가 뒤처졌습니다`,
    ...tags.map((tag) => `  - drizzle/${tag}.sql`),
    '  적용: 이 서버와 같은 DATABASE_URL 로 `pnpm db:migrate` (자동 적용하지 않습니다)',
    '  적용 전 백업 권장: pg_dump -Fc',
    line,
  ].join('\n');
}
