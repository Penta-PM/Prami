import { sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { queryCount } from '@/server/imports/sql-rows';

/**
 * 원가 **행 수 전용** (PRAMI-003 §4.3.10 헬스 deep·§4.9.2 data:verify). 원가 값·자재명·품번은 돌려주지 않는다.
 * 원가 모듈 밖에서 import 할 수 있는 유일한 예외다(eslint `opsRowCountException` — server/ops 만).
 * 이 파일에는 숫자를 돌려주는 함수만 둔다 (tests/unit/costs/row-count.test.ts 가 검사).
 */
export async function countMaterialCostRows(db: Db): Promise<number> {
  return queryCount(
    db,
    sql`select count(*)::int as n from material_costs where deleted_at is null`,
  );
}
