import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import {
  importBatches,
  policyApplyRuns,
  stgSalesPrices,
  type ImportBatch,
  type PolicyApplyStats,
} from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { AppError } from '@/lib/result';
import { writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';

import {
  applyItemBatch,
  collectCounts,
  type ApplyCounts,
  createMissingItemStubs,
  loadSalesBatch,
  recomputeAll,
  supersedeManualRows,
} from './apply-steps';
import { ApplyInvariantError, assertInvariants, checkInvariants } from './invariants';

/**
 * "가격정책 적용" (§4.4.1 ~ §4.4.6, R-05 ~ R-08, R-11).
 * 판매단가 배치 + (선택) 품목조회 배치를 한 트랜잭션에서 반영한다. 어느 단계든 실패하면 전부 되돌리고
 * run 을 failed 로 남긴다 (기존 sales_prices·items 무손실, AC-25).
 */
export type ApplyInput = {
  salesBatchId: string;
  /** null = 품목조회 파일 없음(기존 items 유지, 누락 품번만 stub) */
  itemBatchId: string | null;
  /** UI 토글값 — 기존 파일 재사용 여부 (R-11) */
  salesReused: boolean;
  itemReused: boolean;
};

export const APPLY_STEPS = ['items', 'manual', 'load', 'recompute', 'verify'] as const;
export type ApplyStep = (typeof APPLY_STEPS)[number];

export type ApplyContext = {
  handle: DbHandle;
  actor: AuditActor;
  meta: RequestMeta;
  /** 테스트·QA 용 실패 주입 (QA-03e). production 에서는 env.ts 가 거부 */
  failAfter?: ApplyStep;
};

export type ApplyResult = { runId: string; stats: PolicyApplyStats };

export const AUDIT_POLICY_APPLY = 'policy.apply';
export const AUDIT_MANUAL_SUPERSEDED = 'price_policy.superseded_by_import';
/** 동시 적용 방지 advisory lock 키 */
const APPLY_LOCK_KEY = 20_260_923;

async function loadBatch(handle: DbHandle, id: string, kind: ImportBatch['kind'], label: string) {
  const [batch] = await handle.db.select().from(importBatches).where(eq(importBatches.id, id));
  if (!batch || batch.kind !== kind)
    throw new AppError('NOT_FOUND', `${label} 배치를 찾을 수 없습니다`);
  if (batch.status === 'failed' || batch.errorCount > 0) {
    throw new AppError(
      'VALIDATION',
      `${label} 파일에 오류가 있어 적용할 수 없습니다 (${batch.fileName})`,
    );
  }
  return batch;
}

function injectFault(ctx: ApplyContext, step: ApplyStep): void {
  if (ctx.failAfter === step) throw new Error(`[실패 주입] ${step} 단계 이후 중단`);
}

/** 선택한 배치는 applied, 같은 종류의 이전 applied 배치는 superseded (§4.4.6) */
async function markBatches(tx: Tx, batchIds: string[], kinds: ImportBatch['kind'][]) {
  await tx
    .update(importBatches)
    .set({ status: 'superseded', updatedAt: new Date() })
    .where(
      and(
        inArray(importBatches.kind, kinds),
        eq(importBatches.status, 'applied'),
        sql`${importBatches.id} not in (${sql.join(
          batchIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      ),
    );
  await tx
    .update(importBatches)
    .set({ status: 'applied', updatedAt: new Date() })
    .where(inArray(importBatches.id, batchIds));
}

async function auditSuperseded(
  tx: Tx,
  ctx: ApplyContext,
  rows: { id: number; series_key: string; effective_from: string }[],
) {
  for (const row of rows) {
    await writeAudit(tx, {
      actor: ctx.actor,
      action: AUDIT_MANUAL_SUPERSEDED,
      target: { type: 'sales_price', id: String(row.id), label: row.series_key },
      before: { deletedAt: null },
      after: { effectiveFrom: row.effective_from, reason: 'ERP 임포트 우선 (Q-08)' },
      meta: ctx.meta,
    });
  }
}

function buildStats(
  inserted: number,
  counts: ApplyCounts,
  itemStats: { itemsApplied: number; unmappedItemStatus: number },
  manualConflicts: number,
): PolicyApplyStats {
  return {
    inserted,
    seriesCount: counts.seriesCount,
    latestCount: counts.latestCount,
    discardedForced: counts.discardedForced,
    missingItems: counts.missingItems,
    manualPreserved: counts.manualPreserved,
    manualConflicts,
    operatingCount: counts.operatingCount,
    itemsApplied: itemStats.itemsApplied,
    unmappedItemStatus: itemStats.unmappedItemStatus,
    finalSourceMismatch: counts.finalSourceMismatch,
  };
}

/** 6단계 기록: 배치 상태 · run succeeded · 감사 policy.apply */
async function finalizeRun(
  tx: Tx,
  ctx: ApplyContext,
  input: ApplyInput,
  runId: string,
  stats: PolicyApplyStats,
) {
  await markBatches(
    tx,
    [input.salesBatchId, ...(input.itemBatchId ? [input.itemBatchId] : [])],
    input.itemBatchId ? ['sales_price', 'item_master'] : ['sales_price'],
  );
  await tx
    .update(policyApplyRuns)
    .set({ status: 'succeeded', stats, finishedAt: new Date() })
    .where(eq(policyApplyRuns.id, runId));
  await writeAudit(tx, {
    actor: ctx.actor,
    action: AUDIT_POLICY_APPLY,
    target: { type: 'policy_apply_run', id: runId, label: runId },
    after: { ...stats, salesBatchId: input.salesBatchId, itemBatchId: input.itemBatchId },
    meta: ctx.meta,
  });
}

/** 트랜잭션 본문: 3 → 5 → 1 → stub → 2·4 → 검증 → 6(기록) */
async function runSteps(
  tx: Tx,
  ctx: ApplyContext,
  input: ApplyInput,
  runId: string,
  expectedRows: number,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(${APPLY_LOCK_KEY})`);
  const itemStats = input.itemBatchId
    ? await applyItemBatch(tx, input.itemBatchId, input.salesBatchId)
    : { itemsApplied: 0, unmappedItemStatus: 0 };
  injectFault(ctx, 'items');
  const superseded = await supersedeManualRows(tx, input.salesBatchId);
  await auditSuperseded(tx, ctx, superseded);
  injectFault(ctx, 'manual');
  const inserted = await loadSalesBatch(tx, input.salesBatchId);
  await createMissingItemStubs(tx, input.salesBatchId);
  injectFault(ctx, 'load');
  await recomputeAll(tx);
  injectFault(ctx, 'recompute');

  assertInvariants(await checkInvariants(tx));
  const counts = await collectCounts(tx);
  if (inserted !== expectedRows || counts.erpRows !== expectedRows) {
    throw new ApplyInvariantError(`적재 행수 불일치: 기대 ${expectedRows}, 적재 ${counts.erpRows}`);
  }
  injectFault(ctx, 'verify');

  const stats = buildStats(inserted, counts, itemStats, superseded.length);
  await finalizeRun(tx, ctx, input, runId, stats);
  return stats;
}

function failureReason(error: unknown): string {
  if (error instanceof ApplyInvariantError) return error.message;
  if (error instanceof Error && error.message.startsWith('[실패 주입]')) return error.message;
  return '적용 중 오류가 발생했습니다';
}

async function recordFailure(ctx: ApplyContext, runId: string, input: ApplyInput, error: unknown) {
  const reason = failureReason(error);
  const expected = error instanceof ApplyInvariantError || reason.startsWith('[실패 주입]');
  if (!expected) console.error('[applyPolicy] 실패', error);
  await ctx.handle.db
    .update(policyApplyRuns)
    .set({ status: 'failed', error: reason, finishedAt: new Date() })
    .where(eq(policyApplyRuns.id, runId));
  await writeAudit(ctx.handle.db, {
    actor: ctx.actor,
    action: AUDIT_POLICY_APPLY,
    target: { type: 'policy_apply_run', id: runId, label: runId },
    after: { salesBatchId: input.salesBatchId, itemBatchId: input.itemBatchId },
    reason,
    result: 'error',
    meta: ctx.meta,
  });
  return reason;
}

export async function applyPolicy(ctx: ApplyContext, input: ApplyInput): Promise<ApplyResult> {
  const salesBatch = await loadBatch(ctx.handle, input.salesBatchId, 'sales_price', '판매단가');
  if (input.itemBatchId) await loadBatch(ctx.handle, input.itemBatchId, 'item_master', '품목조회');
  const expectedRows = await ctx.handle.db.$count(
    stgSalesPrices,
    eq(stgSalesPrices.batchId, salesBatch.id),
  );

  const run = firstRow(
    await ctx.handle.db
      .insert(policyApplyRuns)
      .values({
        salesBatchId: input.salesBatchId,
        itemBatchId: input.itemBatchId,
        salesReused: input.salesReused,
        itemReused: input.itemReused,
        status: 'running',
        runBy: ctx.actor.id,
      })
      .returning({ id: policyApplyRuns.id }),
    'policy_apply_runs insert',
  );

  try {
    const stats = await withTransaction(
      (tx) => runSteps(tx, ctx, input, run.id, expectedRows),
      ctx.handle,
    );
    return { runId: run.id, stats };
  } catch (error) {
    const reason = await recordFailure(ctx, run.id, input, error);
    throw new AppError(
      'INTERNAL',
      `가격정책 적용에 실패했습니다: ${reason}. 기존 데이터는 변경되지 않았습니다.`,
      undefined,
      { runId: run.id },
    );
  }
}
