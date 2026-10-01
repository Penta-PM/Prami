'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDb, getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { AppError } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import type { SessionUser } from '@/server/auth/session-user';
import {
  AUDIT_PRICE_CREATE,
  AUDIT_PRICE_DELETE,
  AUDIT_PRICE_UPDATE,
  createPricePolicy,
  deletePricePolicy,
  lookupItem,
  updatePricePolicy,
  type PolicyResult,
  type PricingContext,
} from '@/server/pricing/mutations';
import { getPriceRowDetail, type PriceRowDetail } from '@/server/pricing/queries';
import type { DeletePolicyInput, PolicyInput, UpdatePolicyInput } from '@/server/pricing/schemas';

/** 가격정책 Server Actions (§4.7). 읽기 = pricing.read, 등록·수정·삭제 = pricing.write */
const ADMIN_PATH = '/admin/policies';

async function context(actor: SessionUser): Promise<PricingContext> {
  return {
    handle: await getDbHandle(),
    actor: { id: actor.id, label: actor.email },
    meta: await currentRequestMeta(),
  };
}

function refresh() {
  revalidatePath(ADMIN_PATH);
  revalidatePath('/pricing');
}

export async function getPriceRowDetailAction(id: number): Promise<ActionResult<PriceRowDetail>> {
  const guard = {
    permission: 'pricing.read',
    auditAction: 'price_policy.read',
    name: 'getPriceRowDetail',
  } as const;
  return runAction(guard, async (actor) => {
    const detail = await getPriceRowDetail(
      await getDb(),
      z.coerce.number().int().positive().parse(id),
      { includeRemark: actor.role === 'ADMIN' },
    );
    if (!detail) throw new AppError('NOT_FOUND', '가격정책을 찾을 수 없습니다');
    return detail;
  });
}

export async function createPricePolicyAction(
  input: PolicyInput,
): Promise<ActionResult<PolicyResult>> {
  const guard = {
    permission: 'pricing.write',
    auditAction: AUDIT_PRICE_CREATE,
    name: 'upsertPricePolicy',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await createPricePolicy(await context(actor), input);
    refresh();
    return result;
  });
}

export async function updatePricePolicyAction(
  input: UpdatePolicyInput,
): Promise<ActionResult<PolicyResult>> {
  const guard = {
    permission: 'pricing.write',
    auditAction: AUDIT_PRICE_UPDATE,
    name: 'upsertPricePolicy',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await updatePricePolicy(await context(actor), input);
    refresh();
    return result;
  });
}

export async function deletePricePolicyAction(
  input: DeletePolicyInput,
): Promise<ActionResult<{ id: number }>> {
  const guard = {
    permission: 'pricing.write',
    auditAction: AUDIT_PRICE_DELETE,
    name: 'deletePricePolicy',
  } as const;
  return runAction(guard, async (actor) => {
    const result = await deletePricePolicy(await context(actor), input);
    refresh();
    return result;
  });
}

export type ItemLookup = Awaited<ReturnType<typeof lookupItem>>;

/** 등록 모달: 품번 → 품명·제품군·단위·품목상태 (폐기 안내, AC-23) */
export async function lookupItemAction(itemCode: string): Promise<ActionResult<ItemLookup>> {
  const guard = {
    permission: 'pricing.write',
    auditAction: 'price_policy.lookup',
    name: 'lookupItem',
  } as const;
  return runAction(guard, async () =>
    lookupItem(await getDbHandle(), z.string().max(50).parse(itemCode)),
  );
}
