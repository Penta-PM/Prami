'use server';

import { revalidatePath } from 'next/cache';

import { getDbHandle } from '@/db';
import {
  AUDIT_DELIVERY_EXCLUDE,
  AUDIT_DELIVERY_RESTORE,
  AUDIT_DELIVERY_UPDATE,
  deliveryIdInputSchema,
  type DeliveryIdInput,
  type DeliveryUpdateInput,
} from '@/features/procurement/admin/deliveries/fields';
import { AppError, type ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import { AUDIT_PROCUREMENT_WRITE, requireProcurementAccess } from '@/server/procurement/access';
import { getDeliveryDetail, type DeliveryDetail } from '@/server/procurement/deliveries';
import {
  excludeDelivery,
  restoreDelivery,
  updateDelivery,
  type DeliveryExcludeResult,
  type DeliveryMutationContext,
  type DeliveryUpdateResult,
} from '@/server/procurement/delivery-mutations';

/**
 * 조달 관리 · 실적 관리 Server Actions (조달이 통합 UI-6). 표 목록은 RSC 섹션(DeliveriesAdminSection)이 URL 로 읽는다 — 여기는 편집 열기(상세·이력)와 쓰기. 모두 `procurement.write`(ADMIN) — 거부 시 FORBIDDEN 봉투 + 감사 denied
 * (편집 열기 = procurement.write, 쓰기 = procurement.delivery.update|exclude|restore). 쓰기는 이력·감사를 같은 트랜잭션에 남긴다(D-8).
 */

/** 실적이 바뀌면 통계 화면(조달 실적 현황·등록 품목 계약단가)과 관리 화면을 다시 그린다 */
function refresh() {
  revalidatePath('/procurement');
  revalidatePath('/procurement/items');
  revalidatePath('/admin/procurement');
}

async function context(name: string): Promise<DeliveryMutationContext> {
  return {
    handle: await getDbHandle(),
    access: await requireProcurementAccess('write', `action:${name}`),
    meta: await currentRequestMeta(),
  };
}

/** 편집 열기 — 전 필드 + 최근 변경 이력 10건. 없어진 행이면 NOT_FOUND */
export async function getDeliveryDetailAction(
  input: DeliveryIdInput,
): Promise<ActionResult<DeliveryDetail>> {
  const guard = {
    permission: 'procurement.write',
    auditAction: AUDIT_PROCUREMENT_WRITE,
    name: 'getDeliveryDetail',
  } as const;
  return runAction(guard, async () => {
    const { id } = deliveryIdInputSchema.parse(input);
    const access = await requireProcurementAccess('write', 'action:getDeliveryDetail');
    const { db } = await getDbHandle();
    const detail = await getDeliveryDetail(access, db, id);
    if (!detail) throw new AppError('NOT_FOUND', '납품요구를 찾을 수 없습니다');
    return detail;
  });
}

/** 편집 저장 (바뀐 칸만, 동시 편집 재검증) */
export async function updateDeliveryAction(
  input: DeliveryUpdateInput,
): Promise<ActionResult<DeliveryUpdateResult>> {
  const guard = {
    permission: 'procurement.write',
    auditAction: AUDIT_DELIVERY_UPDATE,
    name: 'updateDelivery',
  } as const;
  return runAction(guard, async () => {
    const result = await updateDelivery(await context('updateDelivery'), input);
    if (result.changed > 0) refresh();
    return result;
  });
}

/** 휴지통으로 */
export async function excludeDeliveryAction(
  input: DeliveryIdInput,
): Promise<ActionResult<DeliveryExcludeResult>> {
  const guard = {
    permission: 'procurement.write',
    auditAction: AUDIT_DELIVERY_EXCLUDE,
    name: 'excludeDelivery',
  } as const;
  return runAction(guard, async () => {
    const result = await excludeDelivery(await context('excludeDelivery'), input);
    refresh();
    return result;
  });
}

/** 휴지통에서 되살리기 */
export async function restoreDeliveryAction(
  input: DeliveryIdInput,
): Promise<ActionResult<DeliveryExcludeResult>> {
  const guard = {
    permission: 'procurement.write',
    auditAction: AUDIT_DELIVERY_RESTORE,
    name: 'restoreDelivery',
  } as const;
  return runAction(guard, async () => {
    const result = await restoreDelivery(await context('restoreDelivery'), input);
    refresh();
    return result;
  });
}
