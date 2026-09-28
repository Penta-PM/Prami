import { and, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Db } from '@/db';
import {
  importBatches,
  policyApplyRuns,
  type ImportBatch,
  type PolicyApplyStats,
} from '@/db/schema';

/** "기존 파일 재사용" 드롭다운 후보 수 (§4.5.3: 최근 10개) */
export const REUSABLE_BATCH_LIMIT = 10;

export type BatchOption = {
  id: string;
  fileName: string;
  status: ImportBatch['status'];
  rowCount: number;
  createdAt: string;
};

/** 적용 가능한(오류 0건, failed 아님) 최근 배치 */
export async function listReusableBatches(
  db: Db,
  kind: ImportBatch['kind'],
): Promise<BatchOption[]> {
  const rows = await db
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      status: importBatches.status,
      rowCount: importBatches.rowCount,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.kind, kind),
        ne(importBatches.status, 'failed'),
        eq(importBatches.errorCount, 0),
        gt(importBatches.rowCount, 0),
      ),
    )
    .orderBy(desc(importBatches.createdAt))
    .limit(REUSABLE_BATCH_LIMIT);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export type CurrentApply = {
  runId: string;
  finishedAt: string;
  stats: PolicyApplyStats | null;
  sales: { id: string; fileName: string };
  item: { id: string; fileName: string } | null;
};

/** 현재 유효 상태 = status='succeeded' 인 최신 run (§4.3.3) — 화면 상단 "현재 적용" 배지 */
export async function getCurrentApply(db: Db): Promise<CurrentApply | null> {
  const salesBatch = alias(importBatches, 'sales_batch');
  const itemBatch = alias(importBatches, 'item_batch');
  const [row] = await db
    .select({
      runId: policyApplyRuns.id,
      finishedAt: policyApplyRuns.finishedAt,
      stats: policyApplyRuns.stats,
      salesId: salesBatch.id,
      salesFile: salesBatch.fileName,
      itemId: itemBatch.id,
      itemFile: itemBatch.fileName,
    })
    .from(policyApplyRuns)
    .innerJoin(salesBatch, eq(salesBatch.id, policyApplyRuns.salesBatchId))
    .leftJoin(itemBatch, eq(itemBatch.id, policyApplyRuns.itemBatchId))
    .where(eq(policyApplyRuns.status, 'succeeded'))
    .orderBy(desc(policyApplyRuns.finishedAt))
    .limit(1);
  if (!row) return null;
  return {
    runId: row.runId,
    finishedAt: (row.finishedAt ?? new Date(0)).toISOString(),
    stats: row.stats,
    sales: { id: row.salesId, fileName: row.salesFile },
    item: row.itemId && row.itemFile ? { id: row.itemId, fileName: row.itemFile } : null,
  };
}

export type RecentRun = {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  error: string | null;
};

/** 최근 적용 이력 (실패 사유 확인용) */
export async function listRecentRuns(db: Db, limit = 5): Promise<RecentRun[]> {
  const rows = await db
    .select({
      id: policyApplyRuns.id,
      status: policyApplyRuns.status,
      startedAt: policyApplyRuns.startedAt,
      error: policyApplyRuns.error,
    })
    .from(policyApplyRuns)
    .where(inArray(policyApplyRuns.status, ['succeeded', 'failed']))
    .orderBy(desc(policyApplyRuns.startedAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, startedAt: row.startedAt.toISOString() }));
}
