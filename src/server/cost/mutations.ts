import 'server-only';

import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import type { DbHandle } from '@/db';
import { firstRow } from '@/db/rows';
import { materialCosts, type MaterialCost } from '@/db/schema';
import { withTransaction, type Tx } from '@/db/tx';
import { deriveMaterialFamily } from '@/lib/constants/material-family';
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
 * 원가 등록·수정·삭제 (§4.5.5, §4.4.7 r4 4 `upsertMaterialCost`). 변경 사유 필수, 해당 계열만 재계산,
 * 감사(변경 전/후 원본 12컬럼 스냅샷). 수정 시 source 는 manual 로 바뀐다(다음 임포트에서 ERP 값으로 대체될 수 있음).
 * 같은 계열·같은 적용시작일은 앱 검사로 차단한다(ERP 행 포함) — 중복은 ERP 원본에서만 들어온다.
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

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

/** 수동 등록 (§4.3.4 12컬럼 중 사용자가 입력하는 것 + 사유). 최종여부는 계열 재계산이 정하므로 받지 않는다 */
export const createCostSchema = z.object({
  materialCode: required('자재번호', 100),
  materialName: required('자재명', 300),
  spec: optionalText(300),
  unit: required('단위', 20),
  priceType: required('단가유형', 100),
  priceCategory: required('단가구분', 100),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, '화폐는 3자리 코드입니다'),
  unitCost: amount,
  effectiveFrom: z.iso.date('적용시작일(YYYY-MM-DD)을 입력하세요'),
  remark: optionalText(500),
  appliesToAllCustomers: z.boolean().default(false),
  reason: required('변경 사유', 500),
});

export const deleteCostSchema = z.object({
  id: z.coerce.number().int().positive(),
  reason: required('변경 사유', 500),
});

export type UpdateCostInput = z.input<typeof updateCostSchema>;
export type CreateCostInput = z.input<typeof createCostSchema>;
/** id 가 있으면 수정, 없으면 등록 */
export type UpsertCostInput = CreateCostInput | UpdateCostInput;
export type DeleteCostInput = z.input<typeof deleteCostSchema>;

export type CostMutationContext = { handle: DbHandle; access: CostAccess; meta: RequestMeta };

export const AUDIT_COST_CREATE = 'material_cost.create';
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

async function guardDuplicate(tx: Tx, seriesKey: string, effectiveFrom: string, excludeId = 0) {
  const [clash] = await tx
    .select({ id: materialCosts.id })
    .from(materialCosts)
    .where(
      and(
        eq(materialCosts.seriesKey, seriesKey),
        eq(materialCosts.effectiveFrom, effectiveFrom),
        isNull(materialCosts.deletedAt),
        ne(materialCosts.id, excludeId),
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
    if (input.effectiveFrom !== before.effectiveFrom) {
      await guardDuplicate(tx, before.seriesKey, input.effectiveFrom, before.id);
    }
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

export async function createMaterialCost(ctx: CostMutationContext, raw: CreateCostInput) {
  assertCostAccess(ctx.access, 'write');
  const { reason, ...input } = createCostSchema.parse(raw);
  return withTransaction(async (tx) => {
    await guardDuplicate(tx, costSeriesKey(input), input.effectiveFrom);
    const created = firstRow(
      await tx
        .insert(materialCosts)
        .values({
          ...input,
          isFinalSource: false,
          source: 'manual',
          productFamily: deriveMaterialFamily(input.materialCode),
          createdBy: ctx.access.userId,
          updatedBy: ctx.access.userId,
        })
        .returning(),
      'material_costs insert',
    );
    await recomputeAndVerify(tx, created.seriesKey);
    await writeAudit(tx, {
      actor: actor(ctx),
      action: AUDIT_COST_CREATE,
      target: {
        type: 'material_cost',
        id: String(created.id),
        label: `${created.materialCode} ${created.materialName}`,
      },
      after: costSnapshot(created),
      reason,
      meta: ctx.meta,
    });
    const [status] = await tx
      .select({ operationStatus: materialCosts.operationStatus })
      .from(materialCosts)
      .where(eq(materialCosts.id, created.id));
    return { id: created.id, operationStatus: status?.operationStatus ?? '미사용' };
  }, ctx.handle);
}

export function isUpdateInput(raw: UpsertCostInput): raw is UpdateCostInput {
  return 'id' in raw && raw.id !== undefined && raw.id !== '';
}

/** §4.4.7 r4 4: id 가 있으면 수정, 없으면 등록 */
export function upsertMaterialCost(ctx: CostMutationContext, raw: UpsertCostInput) {
  return isUpdateInput(raw) ? updateMaterialCost(ctx, raw) : createMaterialCost(ctx, raw);
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
