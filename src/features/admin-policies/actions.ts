'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDbHandle } from '@/db';
import { env } from '@/env';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import {
  applyPolicy,
  AUDIT_POLICY_APPLY,
  previewItemMerge,
  type ApplyResult,
  type ItemMergePreview,
} from '@/server/imports/apply-policy';

const applyPolicySchema = z.object({
  salesBatchId: z.uuid('판매단가 파일을 선택하세요'),
  itemBatchId: z.uuid().nullable(),
  salesReused: z.boolean(),
  itemReused: z.boolean(),
  /** 품목 배치에 직전 대분류가 빠졌을 때 병합 방식 (PRAMI-003 §4.2.3) */
  itemMerge: z.enum(['merge', 'replace']).optional(),
});

export type ApplyPolicyInput = z.input<typeof applyPolicySchema>;

/** 가격정책 적용 (§4.7 applyPolicy, pricing.write). 결과·실패 모두 감사 로그 policy.apply */
export async function applyPolicyAction(
  input: ApplyPolicyInput,
): Promise<ActionResult<ApplyResult>> {
  const guard = {
    permission: 'pricing.write',
    auditAction: AUDIT_POLICY_APPLY,
    name: 'applyPolicy',
  } as const;
  return runAction(guard, async (actor) => {
    const parsed = applyPolicySchema.parse(input);
    const result = await applyPolicy(
      {
        handle: await getDbHandle(),
        actor: { id: actor.id, label: actor.email },
        meta: await currentRequestMeta(),
        failAfter: env.NODE_ENV === 'production' ? undefined : env.IMPORT_FAULT_INJECTION,
      },
      parsed,
    );
    revalidatePath('/admin/policies');
    return result;
  });
}

/** 품목 배치 적용 시 빠지는 제품군·사라질 품번 수 (병합 방식 선택·전량 교체 확인 모달, PRAMI-003 §4.2.3) */
export async function previewItemMergeAction(
  itemBatchId: string,
): Promise<ActionResult<ItemMergePreview>> {
  const guard = {
    permission: 'pricing.write',
    auditAction: AUDIT_POLICY_APPLY,
    name: 'previewItemMerge',
  } as const;
  return runAction(guard, async () =>
    previewItemMerge(await getDbHandle(), z.uuid().parse(itemBatchId)),
  );
}
