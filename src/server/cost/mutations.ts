import 'server-only';

import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { materialCosts, type MaterialCost } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { withParticle } from '@/lib/korean';
import { AppError } from '@/lib/result';
import { writeAudit, type RequestMeta } from '@/server/audit/log';
import { ApplyInvariantError } from '@/server/imports/invariants';
import { queryCount } from '@/server/imports/sql-rows';

import { assertCostAccess, type CostAccess } from './access-token';
import {
  COST_I2_VIOLATIONS_SQL,
  costSeriesKey,
  recomputeCostSeriesSql,
  RESET_DELETED_COSTS_SQL,
} from './series';

/**
 * 원가 수정·삭제 (§4.5.5, §6 PR-5). 변경 사유 필수, 해당 계열만 재계산, 감사(변경 전/후 원본 12컬럼 스냅샷).
 * 수정 시 source 는 manual 로 바뀐다(판매단가와 같은 규칙, 다음 임포트에서 ERP 값으로 대체될 수 있음).
 */
const required = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${withParticle(label, '을/를')} 입력하세요`)
    .max(max);

const amount = z.coerce
  .number({ error: '원가는 숫자여야 합니다' })
  .min(0, '원가는 0 이상이어야 합니다')
  .max(1e15)
  .transform((value) => value.toFixed(2));

export const updateCostSchema = z.object({
  id: z.coerce.number().int().positive(),
  unitCost: amount,
  effectiveFrom: z.iso.date('적용시작일(YYYY-MM-DD)을 입력하세요'),
  remark: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || null)
    .optional()
    .transform((value) => value ?? null),
  reason: required('변경 사유', 500),
});

export const deleteCostSchema = z.object({
  id: z.coerce.number().int().positive(),
  reason: required('변경 사유', 500),
});

export type UpdateCostInput = z.input<typeof updateCostSchema>;
export type DeleteCostInput = z.input<typeof deleteCostSchema>;

export type CostMutationContext = { handle: DbHandle; access: CostAccess; meta: RequestMeta };

export const AUDIT_COST_UPDATE = 'material_cost.update';
export const AUDIT_COST_DELETE = 'material_cost.delete';

const SOURCE_KEYS = [
  'materialCode',
  'materialName',
  'spec',
  'unit',
  'priceType',
  'priceCategory',
  'currency',
  'unitCost',
  'effectiveFrom',
  'isFinalSource',
  'remark',
  'appliesToAllCustomers',
] as const;

export function costSnapshot(row: MaterialCost): Record<string, unknown> {
  return { ...Object.fromEntries(SOURCE_KEYS.map((key) => [key, row[key]])), source: row.source };
}

async function findActive(tx: Tx, id: number): Promise<MaterialCost> {
  const [row] = await tx
    .select()
    .from(materialCosts)
    .where(and(eq(materialCosts.id, id), isNull(materialCosts.deletedAt)));
  if (!row) throw new AppError('NOT_FOUND', '원가를 찾을 수 없습니다');
  return row;
}

async function guardDuplicate(tx: Tx, row: MaterialCost, effectiveFrom: string) {
  const [clash] = await tx
    .select({ id: materialCosts.id })
    .from(materialCosts)
    .where(
      and(
        eq(materialCosts.seriesKey, costSeriesKey(row)),
        eq(materialCosts.effectiveFrom, effectiveFrom),
        isNull(materialCosts.deletedAt),
        ne(materialCosts.id, row.id),
      ),
    )
    .limit(1);
  if (clash) {
    throw new AppError('CONFLICT', '같은 자재·적용시작일의 원가가 이미 있습니다', {
      effectiveFrom: ['같은 자재번호·단가유형·단가구분·화폐에 같은 적용시작일이 있습니다'],
    });
  }
}

async function recomputeAndVerify(tx: Tx, seriesKey: string) {
  await tx.execute(recomputeCostSeriesSql([seriesKey]));
  await tx.execute(RESET_DELETED_COSTS_SQL);
  const i2 = await queryCount(tx, COST_I2_VIOLATIONS_SQL);
  if (i2 > 0) throw new ApplyInvariantError(`불변식 I-2 위반: 계열 ${i2}개`);
}

function actor(ctx: CostMutationContext) {
  return { id: ctx.access.userId, label: ctx.access.email };
}

export async function updateMaterialCost(ctx: CostMutationContext, raw: UpdateCostInput) {
  assertCostAccess(ctx.access, 'write');
  const input = updateCostSchema.parse(raw);
  return withTransaction(async (tx) => {
    const before = await findActive(tx, input.id);
    // 날짜를 옮길 때만 검사한다 — ERP 파일이 같은 날짜 중복을 들고 온 행(Main 결정 B)은 날짜를 그대로 두고 값만 고칠 수 있어야 한다
    if (input.effectiveFrom !== before.effectiveFrom)
      await guardDuplicate(tx, before, input.effectiveFrom);
    const updated = firstRow(
      await tx
        .update(materialCosts)
        .set({
          unitCost: input.unitCost,
          effectiveFrom: input.effectiveFrom,
          remark: input.remark,
          source: 'manual',
          importBatchId: null,
          updatedBy: ctx.access.userId,
          updatedAt: new Date(),
        })
        .where(eq(materialCosts.id, input.id))
        .returning(),
      'material_costs update',
    );
    await recomputeAndVerify(tx, before.seriesKey);
    await writeAudit(tx, {
      actor: actor(ctx),
      action: AUDIT_COST_UPDATE,
      target: {
        type: 'material_cost',
        id: String(updated.id),
        label: `${updated.materialCode} ${updated.materialName}`,
      },
      before: costSnapshot(before),
      after: costSnapshot(updated),
      reason: input.reason,
      meta: ctx.meta,
    });
    const [status] = await tx
      .select({ operationStatus: materialCosts.operationStatus })
      .from(materialCosts)
      .where(eq(materialCosts.id, updated.id));
    return { id: updated.id, operationStatus: status?.operationStatus ?? '미사용' };
  }, ctx.handle);
}

export async function deleteMaterialCost(ctx: CostMutationContext, raw: DeleteCostInput) {
  assertCostAccess(ctx.access, 'write');
  const { id, reason } = deleteCostSchema.parse(raw);
  return withTransaction(async (tx) => {
    const before = await findActive(tx, id);
    await tx
      .update(materialCosts)
      .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.access.userId })
      .where(eq(materialCosts.id, id));
    await recomputeAndVerify(tx, before.seriesKey);
    await writeAudit(tx, {
      actor: actor(ctx),
      action: AUDIT_COST_DELETE,
      target: {
        type: 'material_cost',
        id: String(id),
        label: `${before.materialCode} ${before.materialName}`,
      },
      before: costSnapshot(before),
      after: { deletedAt: 'now' },
      reason,
      meta: ctx.meta,
    });
    return { id };
  }, ctx.handle);
}
