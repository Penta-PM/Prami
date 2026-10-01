import { sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { parseKekList } from '@/env';
import { countMaterialCostRows } from '@/server/cost/row-count';
import { queryCount } from '@/server/imports/sql-rows';

import { countFixtureAccounts } from './health';

/**
 * 상세 헬스 (PRAMI-003 §4.3.10, AC-330 ②) — ADMIN 전용. 배포 체크리스트 C-8·C-10 과 런북이 쓴다.
 * 개수·불리언만 돌려준다: 원가 값·이메일 목록·키 값은 없다.
 */
export type DeepHealth = {
  fixtureAccounts: number;
  stubItems: number;
  items: number;
  salesPrices: number;
  costRows: number;
  kekActive: boolean;
  rateLimit: { backend: string; reachable: boolean };
};

export type DeepHealthDeps = {
  keks: string | undefined;
  activeKek: number | undefined;
  rateLimitStatus: () => Promise<{ backend: string; reachable: boolean }>;
};

/** 활성 KEK 버전이 키링에 실제로 있는지 (값은 보지 않고 버전만) */
export function hasActiveKek(keks: string | undefined, active: number | undefined): boolean {
  if (!keks || active === undefined) return false;
  return parseKekList(keks)?.some((entry) => entry.version === active) ?? false;
}

export async function deepHealth(db: Db, deps: DeepHealthDeps): Promise<DeepHealth> {
  const [fixtureAccounts, stubItems, items, salesPrices, costRows, rateLimit] = await Promise.all([
    countFixtureAccounts(db),
    queryCount(db, sql`select count(*)::int as n from items where source = 'stub'`),
    queryCount(db, sql`select count(*)::int as n from items`),
    queryCount(db, sql`select count(*)::int as n from sales_prices where deleted_at is null`),
    countMaterialCostRows(db),
    deps.rateLimitStatus(),
  ]);
  return {
    fixtureAccounts,
    stubItems,
    items,
    salesPrices,
    costRows,
    kekActive: hasActiveKek(deps.keks, deps.activeKek),
    rateLimit,
  };
}
