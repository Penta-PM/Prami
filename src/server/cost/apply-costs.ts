import 'server-only';

import { and, eq, ne, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { importBatches, stgMaterialCosts } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { MATERIAL_FAMILY_OTHER, MATERIAL_FAMILY_PREFIXES } from '@/lib/constants/material-family';
import { splitDuplicateGroups, type DuplicateWarnings } from '@/lib/imports/duplicates';
import { AppError } from '@/lib/result';
import { writeAudit, type RequestMeta } from '@/server/audit/log';
import { ApplyInvariantError } from '@/server/imports/invariants';
import { queryCount, queryRows } from '@/server/imports/sql-rows';

import { assertCostAccess, type CostAccess } from './access-token';
import {
  COST_I2_VIOLATIONS_SQL,
  listCostDuplicateGroups,
  recomputeCostSeriesSql,
  RESET_DELETED_COSTS_SQL,
} from './series';

/**
 * 원가 임포트 적용 (§4.4.7, R-14). 판매단가와 같은 배치 재사용 모델(R-11):
 * 검증 통과 배치 → 한 트랜잭션에서 수동 행 충돌 처리 → ERP 행 전량 교체(제품군은 자재번호 접두로 파생, Q-03)
 * → 계열 재계산(2단계만) → I-2·행수 검증 → 배치 applied/superseded → 감사 `cost_import.apply`.
 */
export type CostApplyStats = {
  inserted: number;
  materialCount: number;
  seriesCount: number;
  latestCount: number;
  manualPreserved: number;
  manualConflicts: number;
  otherFamilyRows: number;
  /** r4: 같은 계열·적용시작일 중복이 있는 (계열, 날짜) 그룹 수 — 원본 그대로 적재, source_row 뒤 행 우선 */
  sameDateDuplicateGroups: number;
};

/** 적용 결과 = 통계 + 같은 날짜 중복 경고 목록(전부 / 값이 다른 그룹) — 경고는 적용을 막지 않는다 (§4.4.7 r4 3) */
export type CostApplyResult = {
  stats: CostApplyStats;
  warnings: DuplicateWarnings;
  /** 배치의 헤더 행 인덱스 — 경고의 source_row 를 엑셀 행 번호로 표시하기 위해 */
  headerRowIndex: number;
};

export type CostApplyContext = { handle: DbHandle; access: CostAccess; meta: RequestMeta };

export const AUDIT_COST_APPLY = 'cost_import.apply';
export const AUDIT_COST_SUPERSEDED = 'material_cost.superseded_by_import';
const APPLY_LOCK_KEY = 20_260_928;

function familyCaseSql(): ReturnType<typeof sql> {
  const branches = Object.entries(MATERIAL_FAMILY_PREFIXES).map(
    ([prefix, family]) => sql`when ${prefix} then ${family}`,
  );
  return sql`(case upper(left(trim(s.material_code), 2)) ${sql.join(branches, sql` `)} else ${MATERIAL_FAMILY_OTHER} end)`;
}

async function supersedeManual(tx: Tx, batchId: string, ctx: CostApplyContext) {
  const rows = await queryRows<{ id: number; series_key: string }>(
    tx,
    sql`
    update material_costs m set deleted_at = now(), updated_at = now()
    where m.source = 'manual' and m.deleted_at is null
      and exists (
        select 1 from stg_material_costs s
        where s.batch_id = ${batchId} and s.effective_from = m.effective_from
          and s.material_code || '|' || s.price_type || '|' || s.price_category || '|' || s.currency = m.series_key
      )
    returning m.id, m.series_key`,
  );
  for (const row of rows) {
    await writeAudit(tx, {
      actor: { id: ctx.access.userId, label: ctx.access.email },
      action: AUDIT_COST_SUPERSEDED,
      target: { type: 'material_cost', id: String(row.id), label: row.series_key },
      after: { reason: 'ERP 임포트 우선 (Q-08)' },
      meta: ctx.meta,
    });
  }
  return rows.length;
}

async function loadBatch(tx: Tx, batchId: string): Promise<number> {
  await tx.execute(sql`delete from material_costs where source = 'erp'`);
  const inserted = await queryRows<{ id: number }>(
    tx,
    sql`
    insert into material_costs (material_code, material_name, spec, unit, price_type, price_category,
      currency, unit_cost, effective_from, is_final_source, remark, applies_to_all_customers,
      source, import_batch_id, product_family, source_row)
    select s.material_code, s.material_name, s.spec, s.unit, s.price_type, s.price_category,
      s.currency, s.unit_cost, s.effective_from, s.is_final_source, s.remark, s.applies_to_all_customers,
      'erp', s.batch_id, ${familyCaseSql()},
      s.row_index - b.header_row_index - 1
    from stg_material_costs s
    join import_batches b on b.id = s.batch_id
    where s.batch_id = ${batchId}
    order by s.row_index
    returning id`,
  );
  return inserted.length;
}

async function collect(tx: Tx): Promise<Omit<CostApplyStats, 'inserted' | 'manualConflicts'>> {
  const [row] = await queryRows<Omit<CostApplyStats, 'inserted' | 'manualConflicts'>>(
    tx,
    sql`select
      count(distinct material_code)::int as "materialCount",
      count(distinct series_key)::int as "seriesCount",
      count(*) filter (where is_latest_in_series)::int as "latestCount",
      count(*) filter (where source = 'manual')::int as "manualPreserved",
      count(*) filter (where product_family = ${MATERIAL_FAMILY_OTHER})::int as "otherFamilyRows",
      (select count(*)::int from (
        select 1 from material_costs where deleted_at is null
        group by series_key, effective_from having count(*) > 1) d) as "sameDateDuplicateGroups"
    from material_costs where deleted_at is null`,
  );
  if (!row) throw new Error('원가 통계를 집계하지 못했습니다');
  return row;
}

async function markBatches(tx: Tx, batchId: string) {
  await tx
    .update(importBatches)
    .set({ status: 'superseded', updatedAt: new Date() })
    .where(
      and(
        eq(importBatches.kind, 'material_cost'),
        eq(importBatches.status, 'applied'),
        ne(importBatches.id, batchId),
      ),
    );
  await tx
    .update(importBatches)
    .set({ status: 'applied', updatedAt: new Date() })
    .where(eq(importBatches.id, batchId));
}

async function runApply(
  tx: Tx,
  ctx: CostApplyContext,
  batchId: string,
  expected: number,
): Promise<Omit<CostApplyResult, 'headerRowIndex'>> {
  await tx.execute(sql`select pg_advisory_xact_lock(${APPLY_LOCK_KEY})`);
  const manualConflicts = await supersedeManual(tx, batchId, ctx);
  const inserted = await loadBatch(tx, batchId);
  await tx.execute(recomputeCostSeriesSql());
  await tx.execute(RESET_DELETED_COSTS_SQL);
  const i2 = await queryCount(tx, COST_I2_VIOLATIONS_SQL);
  if (i2 > 0) throw new ApplyInvariantError(`불변식 I-2 위반: 최신 행이 1개가 아닌 계열 ${i2}개`);
  if (inserted !== expected) {
    throw new ApplyInvariantError(`적재 행수 불일치: 기대 ${expected}, 적재 ${inserted}`);
  }
  const stats: CostApplyStats = { inserted, manualConflicts, ...(await collect(tx)) };
  const warnings = splitDuplicateGroups(await listCostDuplicateGroups(tx));
  await markBatches(tx, batchId);
  await writeAudit(tx, {
    actor: { id: ctx.access.userId, label: ctx.access.email },
    action: AUDIT_COST_APPLY,
    target: { type: 'import_batch', id: batchId, label: batchId },
    after: { ...stats, conflictingDuplicateGroups: warnings.conflictingDuplicates.length, batchId },
    meta: ctx.meta,
  });
  return { stats, warnings };
}

export async function applyCostImport(
  ctx: CostApplyContext,
  input: { batchId: string; reused: boolean },
): Promise<CostApplyResult> {
  assertCostAccess(ctx.access, 'write');
  const [batch] = await ctx.handle.db
    .select()
    .from(importBatches)
    .where(eq(importBatches.id, input.batchId));
  if (!batch || batch.kind !== 'material_cost') {
    throw new AppError('NOT_FOUND', '원가 배치를 찾을 수 없습니다');
  }
  if (batch.status === 'failed' || batch.errorCount > 0) {
    throw new AppError(
      'VALIDATION',
      `원가 파일에 오류가 있어 적용할 수 없습니다 (${batch.fileName})`,
    );
  }
  const expected = await ctx.handle.db.$count(
    stgMaterialCosts,
    eq(stgMaterialCosts.batchId, batch.id),
  );
  try {
    const applied = await withTransaction(
      (tx) => runApply(tx, ctx, batch.id, expected),
      ctx.handle,
    );
    return { ...applied, headerRowIndex: batch.headerRowIndex };
  } catch (error) {
    const reason =
      error instanceof ApplyInvariantError ? error.message : '적용 중 오류가 발생했습니다';
    if (!(error instanceof ApplyInvariantError)) console.error('[applyCostImport] 실패', error);
    await writeAudit(ctx.handle.db, {
      actor: { id: ctx.access.userId, label: ctx.access.email },
      action: AUDIT_COST_APPLY,
      target: { type: 'import_batch', id: batch.id, label: batch.fileName },
      reason,
      result: 'error',
      meta: ctx.meta,
    });
    throw new AppError(
      'INTERNAL',
      `원가 적용에 실패했습니다: ${reason}. 기존 데이터는 변경되지 않았습니다.`,
    );
  }
}
