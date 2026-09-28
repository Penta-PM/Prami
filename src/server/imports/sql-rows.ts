import type { SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import type { Tx } from '@/db/tx';

export type Executor = Db | Tx;

/**
 * raw SQL 결과 행. node-postgres·PGlite·neon-serverless 모두 `{ rows }` 모양을 돌려준다.
 * count 는 SQL 에서 ::int 로 캐스팅해 드라이버별 bigint 표현 차이를 없앤다.
 */
export async function queryRows<T>(executor: Executor, query: SQL): Promise<T[]> {
  const result = (await executor.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

export async function queryCount(executor: Executor, query: SQL): Promise<number> {
  const [row] = await queryRows<{ n: number | string }>(executor, query);
  return Number(row?.n ?? 0);
}
