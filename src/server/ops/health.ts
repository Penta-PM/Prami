import { sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { isDeployedEnvironment } from '@/env-deploy';
import { FIXTURE_EMAIL_LIKE } from '@/lib/constants/fixture';
import { queryCount } from '@/server/imports/sql-rows';

import { releaseInfo } from './release';
import { readSchemaState, type MigrationJournal, type SchemaState } from './schema-version';

/**
 * 헬스체크 (PRAMI-003 §4.3.10, AC-330 ①·AC-334). 응답은 `{ ok, release, db, schema, data }` 뿐이다
 * (행 수·호스트·이메일·원가 없음). DB 확인은 `select 1` + 마이그레이션 테이블 조회.
 * `data`: 운영·preview(`VERCEL_ENV` 있음)에서만 fixture 계정 수를 조회해 1 이상이면 'fixture'(503) — 로컬·CI 는 조회 없이 'ok'.
 */
export type HealthBody = {
  ok: boolean;
  release: string;
  db: 'ok' | 'error';
  schema: SchemaState | 'unknown';
  data: 'ok' | 'fixture' | 'unknown';
};

export type HealthDeps = {
  getDb: () => Promise<Db>;
  source?: Record<string, string | undefined>;
  journal?: MigrationJournal;
};

export async function countFixtureAccounts(db: Db): Promise<number> {
  return queryCount(
    db,
    sql`select count(*)::int as n from users where email like ${FIXTURE_EMAIL_LIKE}`,
  );
}

export async function checkHealth(deps: HealthDeps): Promise<{ status: number; body: HealthBody }> {
  const source = deps.source ?? process.env;
  const { release } = releaseInfo(source);
  const deployed = isDeployedEnvironment(source);
  let db: Db;
  try {
    db = await deps.getDb();
    await db.execute(sql`select 1`);
  } catch {
    return {
      status: 503,
      body: { ok: false, release, db: 'error', schema: 'unknown', data: 'unknown' },
    };
  }
  let schema: HealthBody['schema'];
  let data: HealthBody['data'] = 'ok';
  try {
    schema = await readSchemaState(db, deps.journal);
    if (deployed && (await countFixtureAccounts(db)) > 0) data = 'fixture';
  } catch {
    // 스키마 미적용 등으로 조회가 실패하면 불명으로 보고 503
    return {
      status: 503,
      body: { ok: false, release, db: 'ok', schema: 'unknown', data: 'unknown' },
    };
  }
  const ok = schema !== 'behind' && data === 'ok';
  return { status: ok ? 200 : 503, body: { ok, release, db: 'ok', schema, data } };
}
