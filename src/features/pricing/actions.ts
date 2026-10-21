'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getDb, getDbHandle } from '@/db';
import { hasPermission } from '@/lib/constants/permissions';
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
import {
  getPriceHistory,
  getPriceRowDetail,
  type PriceHistory,
  type PriceRowDetail,
} from '@/server/pricing/queries';
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

/**
 * 행 상세 드로어를 연 화면 (pricing-view-hide-price-change Q-V1 = B). 'manage' = 가격정책 관리(/admin/policies).
 * 클라이언트가 보낸 값은 **요청**일 뿐 — 서버가 pricing.write 와 함께 판정한다(isManageScope).
 */
export type PriceDetailMode = 'view' | 'manage';

const DETAIL_MODE = z.enum(['view', 'manage']).catch('view');

/** 관리 화면 범위(계열 이력)인가 = 요청 mode 가 'manage' **그리고** pricing.write (USER 가 mode 를 바꿔 보내도 false) */
function isManageScope(actor: SessionUser, mode: unknown): boolean {
  return DETAIL_MODE.parse(mode) === 'manage' && hasPermission(actor.role, 'pricing.write');
}

/**
 * 행 상세 (§4.7). pricing.read. 같은 계열 이력(`history`)은 관리 화면 + pricing.write 응답에만 —
 * 그 밖(모든 USER, 조회 화면에서 연 ADMIN)은 키 자체가 없고 현재 행 정보만 (pricing-view-hide-price-change Q-V1 = B).
 */
export async function getPriceRowDetailAction(
  id: number,
  mode: PriceDetailMode = 'view',
): Promise<ActionResult<PriceRowDetail>> {
  const guard = {
    permission: 'pricing.read',
    auditAction: 'price_policy.read',
    name: 'getPriceRowDetail',
  } as const;
  return runAction(guard, async (actor) => {
    const detail = await getPriceRowDetail(
      await getDb(),
      z.coerce.number().int().positive().parse(id),
      { includeRemark: actor.role === 'ADMIN', includeHistory: isManageScope(actor, mode) },
    );
    if (!detail) throw new AppError('NOT_FOUND', '가격정책을 찾을 수 없습니다');
    return detail;
  });
}

/**
 * 가격 변동 이력 모달 (price-change-history-modal §2.1-4): 가격 행 id(양의 정수)만 받는다 — series_key 입력 경로 없음.
 * **pricing.write**(관리 화면 전용, pricing-view-hide-price-change §3) — 조회 권한만으로는 호출할 수 없다(거부·감사는 runAction).
 * 품목 마스터 ERP 비고는 ADMIN 응답의 요약(series)에만, 행별 판매단가 비고(remark)는 응답 모두(§6 A). 원가 모듈 import·원가 키 없음.
 */
export async function getPriceHistoryAction(id: number): Promise<ActionResult<PriceHistory>> {
  const guard = {
    permission: 'pricing.write',
    auditAction: 'price_policy.read',
    name: 'getPriceHistory',
  } as const;
  return runAction(guard, async (actor) => {
    const history = await getPriceHistory(
      await getDb(),
      z.coerce.number().int().positive().parse(id),
      { includeRemark: actor.role === 'ADMIN' },
    );
    if (!history) throw new AppError('NOT_FOUND', '삭제되었거나 찾을 수 없는 가격입니다.');
    return history;
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
