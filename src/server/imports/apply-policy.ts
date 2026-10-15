import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import {
  importBatches,
  policyApplyRuns,
  stgSalesPrices,
  items,
  type ImportBatch,
  type ItemMerge,
  type PolicyApplyStats,
} from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { AppError } from '@/lib/result';
import { writeAudit, type AuditActor, type RequestMeta } from '@/server/audit/log';
import { insertForActiveUsers } from '@/server/notifications/audience';
import { NOTIFICATION_REF, notificationContent } from '@/server/notifications/types';

import {
  applyItemBatch,
  collectCounts,
  collectItemChecks,
  type ApplyCounts,
  type ItemApplyChecks,
  createMissingItemStubs,
  loadSalesBatch,
  recomputeAll,
  supersedeManualRows,
} from './apply-steps';
import { ApplyInvariantError, assertInvariants, checkInvariants } from './invariants';
import { batchMajors } from './item-upload';
import { queryCount } from './sql-rows';
import { logger } from '@/server/log';

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
  /**
   * 품목 배치에 직전 적용 품목의 대분류가 빠졌을 때 병합 방식 (PRAMI-003 §4.2.3, Q-10).
   * merge = 누락 제품군은 직전 값 유지(기본), replace = 전량 교체(누락 제품군 품번은 stub). 누락이 있는데 없으면 VALIDATION.
   */
  itemMerge?: 'merge' | 'replace';
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
  item: { merge: ItemMerge; checks: ItemApplyChecks } | null,
): PolicyApplyStats {
  return {
    ...(item ? { itemMerge: item.merge, ...item.checks } : {}),
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
    .set({
      status: 'succeeded',
      stats,
      finishedAt: new Date(),
      ...(stats.itemMerge ? { itemMerge: stats.itemMerge } : {}),
    })
    .where(eq(policyApplyRuns.id, runId));
  await writeAudit(tx, {
    actor: ctx.actor,
    action: AUDIT_POLICY_APPLY,
    target: { type: 'policy_apply_run', id: runId, label: runId },
    after: { ...stats, salesBatchId: input.salesBatchId, itemBatchId: input.itemBatchId },
    meta: ctx.meta,
  });
  await notifyPolicyApplied(tx, ctx, runId, stats);
}

/**
 * #31: 적용 성공을 실행자 외 활성 사용자에게 알린다(같은 트랜잭션, 실패 run 은 여기까지 오지 않는다).
 * 본문은 반영 건수만 — 금액·원가 없음. 사용자 행위자가 없는 스크립트 적용(import:source, actor.id=null)은
 * 클린 설치·복구 절차라 알리지 않는다 (data:verify --fresh 의 notifications 0 과 일관).
 */
async function notifyPolicyApplied(
  tx: Tx,
  ctx: ApplyContext,
  runId: string,
  stats: PolicyApplyStats,
) {
  if (!ctx.actor.id) return;
  await insertForActiveUsers(tx, {
    type: 'policy.applied',
    ...notificationContent.policyApplied(stats.inserted),
    refType: NOTIFICATION_REF.policyApplyRun,
    refId: runId,
    actorUserId: ctx.actor.id,
  });
}

/** 트랜잭션 본문: 3 → 5 → 1 → stub → 2·4 → 검증 → 6(기록) */
async function runSteps(
  tx: Tx,
  ctx: ApplyContext,
  input: ApplyInput,
  runId: string,
  expectedRows: number,
  merge: ItemMerge | null,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(${APPLY_LOCK_KEY})`);
  const itemStats =
    input.itemBatchId && merge
      ? await applyItemBatch(tx, input.itemBatchId, input.salesBatchId, merge)
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

  const item = merge ? { merge, checks: await collectItemChecks(tx) } : null;
  const stats = buildStats(inserted, counts, itemStats, superseded.length, item);
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
  if (!expected) logger.error('import.policy_apply_failed', { runId, error });
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

/** 직전 적용 품목(master)의 대분류 · 직전 적용 품목 배치 */
async function previousItemState(handle: DbHandle) {
  const majors = await handle.db
    .selectDistinct({ major: items.categoryMajor })
    .from(items)
    .where(eq(items.source, 'master'));
  const [batch] = await handle.db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(and(eq(importBatches.kind, 'item_master'), eq(importBatches.status, 'applied')))
    .orderBy(sql`${importBatches.updatedAt} desc`)
    .limit(1);
  return {
    majors: majors.map((row) => row.major).filter((major): major is string => major !== null),
    batchId: batch?.id ?? null,
  };
}

export type ItemMergePreview = {
  /** 직전 적용 품목에 있었지만 이 배치에 없는 대분류 */
  missingFamilies: string[];
  /** 전량 교체 시 사라질(stub 이 될) master 품번 수 */
  vanishingItems: number;
  previousBatchId: string | null;
  /**
   * 운영중 판매단가 행 — 현재와 전량 교체 시 예상 (PRAMI-003 AC-373 ③, PR #19 I-3). 사라지는 품번이 stub(미확인)이 되면
   * 폐기 판정이 풀려 그 최신 행이 운영중이 된다. 이번 배치가 남는 제품군 상태를 바꾸는 효과는 넣지 않는다(병합·교체 공통).
   */
  operating: { now: number; afterReplace: number };
};

async function operatingForecast(
  handle: DbHandle,
  missing: readonly string[],
): Promise<ItemMergePreview['operating']> {
  const now = await queryCount(
    handle.db,
    sql`select count(*)::int as n from sales_prices where deleted_at is null and operation_status = '운영중'`,
  );
  if (missing.length === 0) return { now, afterReplace: now };
  const released = await queryCount(
    handle.db,
    sql`select count(*)::int as n from sales_prices sp join items i on i.item_code = sp.item_code
        where sp.deleted_at is null and sp.is_latest_in_series and i.source = 'master'
          and i.item_status = '폐기'
          and i.category_major in (${sql.join(
            missing.map((major) => sql`${major}`),
            sql`, `,
          )})`,
  );
  return { now, afterReplace: now + released };
}

/** 품목 배치를 적용하면 빠지는 제품군 미리보기 (적용 화면의 병합 방식 선택·확인 모달, §4.2.3) */
export async function previewItemMerge(
  handle: DbHandle,
  itemBatchId: string,
): Promise<ItemMergePreview> {
  const previous = await previousItemState(handle);
  const current = new Set(await batchMajors(handle.db, itemBatchId));
  const missing = previous.majors.filter((major) => !current.has(major)).sort();
  const vanishingItems =
    missing.length === 0
      ? 0
      : await handle.db.$count(
          items,
          and(eq(items.source, 'master'), inArray(items.categoryMajor, missing)),
        );
  return {
    missingFamilies: missing,
    vanishingItems,
    previousBatchId: previous.batchId,
    operating: await operatingForecast(handle, missing),
  };
}

/** 병합 방식 결정: 이번 배치에 없는 직전 대분류가 있으면 선택 필수 (§4.2.3, AC-306) */
async function resolveItemMerge(handle: DbHandle, input: ApplyInput): Promise<ItemMerge | null> {
  if (!input.itemBatchId) return null;
  const preview = await previewItemMerge(handle, input.itemBatchId);
  const missing = preview.missingFamilies;
  if (missing.length > 0 && !input.itemMerge) {
    throw new AppError(
      'VALIDATION',
      `이번 품목 배치에 없는 제품군(${missing.join(', ')})이 있습니다. 병합 방식(유지·전량 교체)을 선택하세요`,
      undefined,
      { code: 'missing_families', ...preview },
    );
  }
  const mode = input.itemMerge ?? 'merge';
  // 이름대로 기록한다 — 전량 교체에서 빠진 대분류는 "유지"가 아니라 "사라짐" (QA L-3)
  return {
    mode,
    keptMajors: mode === 'merge' ? missing : [],
    droppedMajors: mode === 'replace' ? missing : [],
    fromBatchId: preview.previousBatchId,
  };
}

export async function applyPolicy(ctx: ApplyContext, input: ApplyInput): Promise<ApplyResult> {
  const salesBatch = await loadBatch(ctx.handle, input.salesBatchId, 'sales_price', '판매단가');
  if (input.itemBatchId) await loadBatch(ctx.handle, input.itemBatchId, 'item_master', '품목조회');
  const merge = await resolveItemMerge(ctx.handle, input);
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
      (tx) => runSteps(tx, ctx, input, run.id, expectedRows, merge),
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
