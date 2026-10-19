import 'server-only';

import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { importBatches, materialCosts } from '@/db/schema';
import type { CostSortId } from '@/features/costs/sort';
import { MATERIAL_FAMILIES } from '@/lib/constants/material-family';
import { STATUS_ORDERS, type SortDir } from '@/lib/table/compare';
import { dateConditions } from '@/server/pricing/date-filter';
import { buildOrderBy, byMoney, byStatus, byText, byValue } from '@/server/pricing/sort-sql';

import { assertCostAccess, type CostAccess } from './access-token';
import type { CostFilter } from './filter';

/**
 * 원가 조회 (§4.5.5, ADMIN 전용). 모든 함수는 CostAccess 토큰을 첫 인자로 요구한다(첫 줄 검사).
 * 어떤 공개 쿼리도 이 모듈을 import 하지 않는다 — ESLint no-restricted-imports 로 강제(AC-42).
 */
export const COST_PAGE_SIZE = 50;

export type CostRow = {
  id: number;
  materialCode: string;
  materialName: string;
  unit: string;
  unitCost: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  operationStatus: '운영중' | '미사용';
  productFamily: string | null;
  remark: string | null;
  source: 'erp' | 'manual';
};

export type CostPage = { rows: CostRow[]; total: number; page: number; pageCount: number };

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildWhere(filter: CostFilter): SQL | undefined {
  const conditions: SQL[] = [
    isNull(materialCosts.deletedAt) as SQL,
    ...dateConditions(materialCosts, filter),
  ];
  if (filter.family) conditions.push(eq(materialCosts.productFamily, filter.family) as SQL);
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q)}%`;
    conditions.push(
      sql`(${materialCosts.materialName} ilike ${pattern} or ${materialCosts.materialCode} ilike ${pattern})`,
    );
  }
  return and(...conditions);
}

/** 기본 정렬 — 정렬을 고르면 tie-breaker 로 그대로 뒤에 붙는다(stable, 끝은 id) */
const DEFAULT_ORDER: SQL[] = [
  desc(materialCosts.effectiveFrom),
  asc(materialCosts.materialName),
  asc(materialCosts.id),
];

/** 원가 표 정렬 id → ORDER BY 키 (#32 스펙 §2·§3). 화이트리스트 COST_SORT_IDS 와 1:1 */
export const COST_SORT_SQL: Record<CostSortId, (dir: SortDir) => SQL[]> = {
  code: (dir) => byText(materialCosts.materialCode, dir),
  name: (dir) => byText(materialCosts.materialName, dir),
  unit: (dir) => byText(materialCosts.unit, dir),
  cost: (dir) => byMoney(materialCosts.currency, materialCosts.unitCost, dir),
  effectiveFrom: (dir) => [byValue(materialCosts.effectiveFrom, dir)],
  period: (dir) => [
    byValue(materialCosts.effectiveFrom, dir),
    byValue(materialCosts.effectiveTo, dir),
  ],
  status: (dir) => byStatus(materialCosts.operationStatus, STATUS_ORDERS.pricingState, dir),
};

/** getCostRows (§4.7): 제품군 탭·날짜 두 모드·검색, 50행 페이지, 정렬 effective_from DESC·material_name */
export async function getCostRows(
  access: CostAccess,
  db: Db,
  filter: CostFilter,
): Promise<CostPage> {
  assertCostAccess(access, 'read');
  const where = buildWhere(filter);
  const [counted] = await db.select({ total: count() }).from(materialCosts).where(where);
  const total = counted?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / COST_PAGE_SIZE));
  const page = Math.min(filter.page, pageCount);
  const rows = await db
    .select({
      id: materialCosts.id,
      materialCode: materialCosts.materialCode,
      materialName: materialCosts.materialName,
      unit: materialCosts.unit,
      unitCost: materialCosts.unitCost,
      currency: materialCosts.currency,
      effectiveFrom: materialCosts.effectiveFrom,
      effectiveTo: materialCosts.effectiveTo,
      operationStatus: materialCosts.operationStatus,
      productFamily: materialCosts.productFamily,
      remark: materialCosts.remark,
      source: materialCosts.source,
    })
    .from(materialCosts)
    .where(where)
    .orderBy(...buildOrderBy(filter.sort, COST_SORT_SQL, DEFAULT_ORDER))
    .limit(COST_PAGE_SIZE)
    .offset((page - 1) * COST_PAGE_SIZE);
  return { rows, total, page, pageCount };
}

/** 제품군 탭: 고정 순서(WAPPLES·D.AMO·iSIGN·기타) 중 데이터가 있는 것 + 건수 */
export async function listCostFamilies(
  access: CostAccess,
  db: Db,
): Promise<{ family: string; count: number }[]> {
  assertCostAccess(access, 'read');
  const rows = await db
    .select({ family: materialCosts.productFamily, count: count() })
    .from(materialCosts)
    .where(isNull(materialCosts.deletedAt))
    .groupBy(materialCosts.productFamily);
  const counts = new Map(rows.map((row) => [row.family ?? '', row.count]));
  return MATERIAL_FAMILIES.filter((family) => counts.has(family)).map((family) => ({
    family,
    count: counts.get(family) ?? 0,
  }));
}

export async function listCostYears(access: CostAccess, db: Db): Promise<number[]> {
  assertCostAccess(access, 'read');
  const rows = await db
    .selectDistinct({ year: sql<number>`extract(year from ${materialCosts.effectiveFrom})::int` })
    .from(materialCosts)
    .where(isNull(materialCosts.deletedAt))
    .orderBy(desc(sql`1`));
  return rows.map((row) => Number(row.year));
}

export type CurrentCostApply = { batchId: string; fileName: string; appliedAt: string } | null;

/** 현재 적용 중인 원가 배치 (status='applied') */
export async function getCurrentCostApply(access: CostAccess, db: Db): Promise<CurrentCostApply> {
  assertCostAccess(access, 'read');
  const batch = alias(importBatches, 'cost_batch');
  const [row] = await db
    .select({ id: batch.id, fileName: batch.fileName, updatedAt: batch.updatedAt })
    .from(batch)
    .where(and(eq(batch.kind, 'material_cost'), eq(batch.status, 'applied')))
    .orderBy(desc(batch.updatedAt))
    .limit(1);
  return row
    ? {
        batchId: row.id,
        fileName: row.fileName,
        appliedAt: (row.updatedAt ?? new Date(0)).toISOString(),
      }
    : null;
}
