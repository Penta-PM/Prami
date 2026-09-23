import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import { env, type DbDriver } from '@/env';

import * as schema from './schema';

export type Schema = typeof schema;

/** 드라이버에 무관한 Drizzle 인스턴스 타입. 쿼리 코드는 이 타입만 사용한다 (§4.9.1) */
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export type DbHandle = {
  db: Db;
  driver: DbDriver;
  /** neon 트랜잭션 클라이언트(db/tx.ts)가 별도 연결을 열 때 사용 */
  databaseUrl?: string;
  close: () => Promise<void>;
};

export type CreateDbOptions = {
  driver?: DbDriver;
  databaseUrl?: string;
  pgliteDataDir?: string;
};

function requireDatabaseUrl(driver: DbDriver, url: string | undefined): string {
  if (!url) throw new Error(`DB_DRIVER=${driver} 에는 DATABASE_URL 이 필요합니다`);
  return url;
}

/** Neon HTTP 드라이버 (Vercel). 대화형 트랜잭션은 db/tx.ts 가 WebSocket 으로 처리 */
async function createNeonDb(databaseUrl: string): Promise<DbHandle> {
  const { neon } = await import('@neondatabase/serverless');
  const { drizzle } = await import('drizzle-orm/neon-http');
  const db = drizzle({ client: neon(databaseUrl), schema });
  return { db, driver: 'neon', databaseUrl, close: async () => undefined };
}

/** node-postgres 풀 (로컬 Docker Postgres · QA · CI e2e) */
async function createPgDb(databaseUrl: string): Promise<DbHandle> {
  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool, schema });
  return { db, driver: 'pg', databaseUrl, close: () => pool.end() };
}

/** PGlite 인프로세스 Postgres (단위·통합 테스트). 마이그레이션이 쓰는 확장을 함께 로드 */
async function createPgliteDb(dataDir: string): Promise<DbHandle> {
  const [{ PGlite }, { pg_trgm }, { citext }, { pgcrypto }, { drizzle }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite/contrib/pg_trgm'),
    import('@electric-sql/pglite/contrib/citext'),
    import('@electric-sql/pglite/contrib/pgcrypto'),
    import('drizzle-orm/pglite'),
  ]);
  const client = await PGlite.create(dataDir, { extensions: { pg_trgm, citext, pgcrypto } });
  const db = drizzle({ client, schema });
  return { db, driver: 'pglite', close: () => client.close() };
}

/** 환경(또는 옵션)에 따라 드라이버를 골라 Drizzle 인스턴스를 만든다 (§4.9.1 팩토리) */
export async function createDb(options: CreateDbOptions = {}): Promise<DbHandle> {
  const driver = options.driver ?? env.DB_DRIVER;
  const databaseUrl = options.databaseUrl ?? env.DATABASE_URL;
  switch (driver) {
    case 'neon':
      return createNeonDb(requireDatabaseUrl(driver, databaseUrl));
    case 'pg':
      return createPgDb(requireDatabaseUrl(driver, databaseUrl));
    case 'pglite':
      return createPgliteDb(options.pgliteDataDir ?? env.PGLITE_DATA_DIR ?? 'memory://');
  }
}

let sharedHandle: Promise<DbHandle> | undefined;

/**
 * 앱 전역 공유 핸들 (지연 생성). 서버 코드는 `const db = await getDb()` 로 사용.
 * 생성이 실패하면(환경변수 누락, 일시적 네트워크 오류) 캐시를 비워 다음 호출이 다시 시도하게 한다.
 */
export function getDbHandle(): Promise<DbHandle> {
  sharedHandle ??= createDb().catch((error: unknown) => {
    sharedHandle = undefined;
    throw error;
  });
  return sharedHandle;
}

/** 테스트·스크립트용: 공유 핸들을 닫고 캐시를 비운다 */
export async function resetDbHandle(): Promise<void> {
  const pending = sharedHandle;
  sharedHandle = undefined;
  if (!pending) return;
  const handle = await pending.catch(() => undefined);
  await handle?.close();
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}

export { schema };
