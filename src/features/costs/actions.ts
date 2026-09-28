'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import { AUDIT_COST_READ, requireCostAccess } from '@/server/cost/access';
import { applyCostImport, AUDIT_COST_APPLY, type CostApplyStats } from '@/server/cost/apply-costs';
import { parseCostFilter } from '@/server/cost/filter';
import {
  calculateNetSalesFor,
  type NetSalesActionInput,
  type NetSalesOutcome,
} from '@/server/cost/margin';
import {
  AUDIT_COST_DELETE,
  AUDIT_COST_UPDATE,
  deleteMaterialCost,
  updateMaterialCost,
  type DeleteCostInput,
  type UpdateCostInput,
} from '@/server/cost/mutations';
import { getCostRows, type CostPage } from '@/server/cost/queries';

/**
 * 원가 Server Actions (§4.7, ADMIN 전용). 거부 시 §4.7.1: FORBIDDEN 봉투 + 감사 `cost.read`/`cost.write`… denied,
 * 원가 값은 절대 반환하지 않는다. 화면 밖(PR-7 계산기)에서는 이 파일의 Action 만 import 한다 — server/cost 직접 import 금지.
 */
const COSTS_PATH = '/admin/costs';

const applySchema = z.object({ batchId: z.uuid('원가 파일을 선택하세요'), reused: z.boolean() });

async function context(scope: 'read' | 'write', target: string) {
  return {
    handle: await getDbHandle(),
    access: await requireCostAccess(scope, target),
    meta: await currentRequestMeta(),
  };
}

/** getCostRows Action (AC-41): USER → FORBIDDEN + 감사 cost.read denied, 응답에 원가 없음 */
export async function getCostRowsAction(
  params: Record<string, string | string[] | undefined>,
): Promise<ActionResult<CostPage>> {
  const guard = {
    permission: 'cost.read',
    auditAction: AUDIT_COST_READ,
    name: 'getCostRows',
  } as const;
  return runAction(guard, async () => {
    const { access, handle } = await context('read', 'action:getCostRows');
    return getCostRows(access, handle.db, parseCostFilter(params).filter);
  });
}

export async function applyCostImportAction(
  input: z.input<typeof applySchema>,
): Promise<ActionResult<CostApplyStats>> {
  const guard = {
    permission: 'cost.write',
    auditAction: AUDIT_COST_APPLY,
    name: 'applyCostImport',
  } as const;
  return runAction(guard, async () => {
    const parsed = applySchema.parse(input);
    const result = await applyCostImport(await context('write', 'action:applyCostImport'), parsed);
    revalidatePath(COSTS_PATH);
    return result;
  });
}

export async function updateMaterialCostAction(input: UpdateCostInput) {
  const guard = {
    permission: 'cost.write',
    auditAction: AUDIT_COST_UPDATE,
    name: 'upsertMaterialCost',
  } as const;
  return runAction(guard, async () => {
    const result = await updateMaterialCost(
      await context('write', 'action:upsertMaterialCost'),
      input,
    );
    revalidatePath(COSTS_PATH);
    return result;
  });
}

export async function deleteMaterialCostAction(input: DeleteCostInput) {
  const guard = {
    permission: 'cost.write',
    auditAction: AUDIT_COST_DELETE,
    name: 'deleteMaterialCost',
  } as const;
  return runAction(guard, async () => {
    const result = await deleteMaterialCost(
      await context('write', 'action:deleteMaterialCost'),
      input,
    );
    revalidatePath(COSTS_PATH);
    return result;
  });
}

/**
 * 순매출 계산 (USER 이상, calculator.use). 원가 잠금은 서버가 역할로 판단한다 —
 * USER 가 unitCost 를 보내도 무시하고 cost 키 없이 응답한다 (§4.5.5). 화면은 PR-7.
 */
export async function calculateNetSalesAction(
  input: NetSalesActionInput,
): Promise<ActionResult<NetSalesOutcome>> {
  const guard = {
    permission: 'calculator.use',
    auditAction: 'calculator.net_sales',
    name: 'calculateNetSales',
  } as const;
  return runAction(guard, async (user) => calculateNetSalesFor(user, input));
}
