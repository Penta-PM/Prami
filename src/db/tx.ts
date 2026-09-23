import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';

import { getDbHandle, type DbHandle, type Schema } from './index';
import * as schema from './schema';

/** 드라이버에 무관한 트랜잭션 핸들 타입 */
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/**
 * 대화형 트랜잭션 (§4.9.1). pg·pglite 는 네이티브 db.transaction(),
 * neon 은 HTTP 드라이버가 트랜잭션을 지원하지 않으므로 WebSocket Pool 로 별도 클라이언트를 연다 (§10 R-3).
 * 임포트 스왑·시드처럼 원자성이 필요한 작업만 이 함수를 쓴다.
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  handle?: DbHandle,
): Promise<T> {
  const resolved = handle ?? (await getDbHandle());
  if (resolved.driver !== 'neon') {
    return resolved.db.transaction((tx) => fn(tx as Tx));
  }
  return withNeonTransaction(fn, resolved);
}

async function withNeonTransaction<T>(fn: (tx: Tx) => Promise<T>, handle: DbHandle): Promise<T> {
  if (!handle.databaseUrl) throw new Error('neon 트랜잭션에는 DATABASE_URL 이 필요합니다');
  const [{ Pool, neonConfig }, { drizzle }, ws] = await Promise.all([
    import('@neondatabase/serverless'),
    import('drizzle-orm/neon-serverless'),
    import('ws'),
  ]);
  neonConfig.webSocketConstructor = ws.default;
  const pool = new Pool({ connectionString: handle.databaseUrl });
  try {
    const db = drizzle({ client: pool, schema });
    return await db.transaction((tx) => fn(tx as Tx));
  } finally {
    await pool.end();
  }
}
