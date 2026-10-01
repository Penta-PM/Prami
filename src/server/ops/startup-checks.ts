import type { Db } from '@/db';
import { isDeployedEnvironment } from '@/env-deploy';
import { logger } from '@/server/log';

import { countFixtureAccounts } from './health';
import {
  BUNDLED_JOURNAL,
  compareSchema,
  latestAppliedMigration,
  latestJournalEntry,
  type MigrationJournal,
  type SchemaState,
} from './schema-version';

/**
 * 기동 시 1회 점검 (PRAMI-003 §4.3.6·§4.9.3 L4). 실패해도 기동은 계속한다(서버리스 기동 실패 루프 방지) —
 * 결과는 로그로 남기고, 배포 스모크가 `/api/health`(503)로 잡는다.
 * - 스키마 뒤처짐 → error `db.schema_behind`, 앞섬 → warn `db.schema_ahead` (태그 이름만)
 * - 운영·preview(`VERCEL_ENV`)에서 fixture 계정이 있으면 error `db.fixture_accounts_present`(개수만)
 */
export type StartupCheckResult = { schema: SchemaState; fixtureAccounts: number | null };

export async function runStartupChecks(
  db: Db,
  source: Record<string, string | undefined> = process.env,
  journal: MigrationJournal = BUNDLED_JOURNAL,
): Promise<StartupCheckResult> {
  const latest = latestJournalEntry(journal);
  const schema = compareSchema(latest?.when ?? null, await latestAppliedMigration(db));
  if (schema === 'behind') logger.error('db.schema_behind', { expected: latest?.tag ?? null });
  if (schema === 'ahead') logger.warn('db.schema_ahead', { bundled: latest?.tag ?? null });

  if (!isDeployedEnvironment(source)) return { schema, fixtureAccounts: null };
  const fixtureAccounts = await countFixtureAccounts(db);
  if (fixtureAccounts > 0) logger.error('db.fixture_accounts_present', { count: fixtureAccounts });
  return { schema, fixtureAccounts };
}
