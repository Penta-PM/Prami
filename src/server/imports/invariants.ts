import { sql } from 'drizzle-orm';

import { queryCount, type Executor } from './sql-rows';

/**
 * 가격정책 불변식 (§4.4.3). run 성공 조건이며, 관리 화면 수동 등록/수정(PR-4)도 저장 직전에 같은 검사를 쓴다.
 * - I-1: item_status='폐기' ⇒ operation_status='미사용'
 * - I-2: 계열당 is_latest_in_series=true 는 정확히 1행
 */
export const I1_VIOLATIONS_SQL = sql`
  select count(*)::int as n
  from sales_prices sp
  join items i on i.item_code = sp.item_code
  where sp.deleted_at is null and i.item_status = '폐기' and sp.operation_status = '운영중'`;

export const I2_VIOLATIONS_SQL = sql`
  select count(*)::int as n from (
    select series_key from sales_prices
    where deleted_at is null
    group by series_key
    having sum(is_latest_in_series::int) <> 1
  ) t`;

export type InvariantReport = { i1: number; i2: number };

export async function checkInvariants(executor: Executor): Promise<InvariantReport> {
  const [i1, i2] = [
    await queryCount(executor, I1_VIOLATIONS_SQL),
    await queryCount(executor, I2_VIOLATIONS_SQL),
  ];
  return { i1, i2 };
}

/** 검증 실패 — 트랜잭션을 되돌리고 run 을 failed 로 남긴다 */
export class ApplyInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyInvariantError';
  }
}

export function assertInvariants(report: InvariantReport): void {
  if (report.i1 > 0) {
    throw new ApplyInvariantError(`불변식 I-1 위반: 폐기 품목의 운영중 행 ${report.i1}건`);
  }
  if (report.i2 > 0) {
    throw new ApplyInvariantError(`불변식 I-2 위반: 최신 행이 1개가 아닌 계열 ${report.i2}개`);
  }
}
