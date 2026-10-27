'use server';

import { revalidatePath } from 'next/cache';

import { getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import { AUDIT_PROCUREMENT_WRITE, requireProcurementAccess } from '@/server/procurement/access';
import {
  addItem,
  editItems,
  excludeItems,
  includeReviewItems,
  restoreItems,
  type AddItemInput,
  type EditItemsInput,
  type ItemMutationContext,
  type ItemMutationResult,
  type ItemTargetsInput,
} from '@/server/procurement/item-mutations';

/**
 * 품목 관리 Server Actions (조달이 통합 UI-7, procurement.write = ADMIN) — 쓰기만. 조회는 서버 섹션(ItemsAdminSection)이 URL 로 한다.
 * 거부: FORBIDDEN 봉투 + 감사 `procurement.write` denied, 함수 미실행.
 * 쓰기는 server/procurement/item-mutations 가 한 트랜잭션에서 이력(item_changes)·감사(audit_logs)를 함께 쓴다(D-8).
 */

const ADMIN_PATH = '/admin/procurement';
/** 품목 상태가 바뀌면 조회 화면(등록 품목·실적 현황 — v_product_deliveries 는 active 품목 기준)도 다시 그린다 */
const AFFECTED_PATHS = [ADMIN_PATH, '/procurement/items', '/procurement'];

const guard = (name: string) =>
  ({ permission: 'procurement.write', auditAction: AUDIT_PROCUREMENT_WRITE, name }) as const;

async function context(name: string): Promise<ItemMutationContext> {
  return {
    handle: await getDbHandle(),
    access: await requireProcurementAccess('write', `action:${name}`),
    meta: await currentRequestMeta(),
  };
}

function revalidate() {
  for (const path of AFFECTED_PATHS) revalidatePath(path);
}

/** 일일 신규 품목 선택 추가·일괄 추가·행 추가 (include / review) */
export async function includeReviewItemsAction(
  input: ItemTargetsInput,
): Promise<ActionResult<ItemMutationResult>> {
  return runAction(guard('includeReviewItems'), async () => {
    const outcome = await includeReviewItems(await context('includeReviewItems'), input);
    revalidate();
    return outcome;
  });
}

/** 휴지통으로 (검토 카드 선택 삭제·등록 품목 행/선택 삭제) */
export async function excludeItemsAction(
  input: ItemTargetsInput,
): Promise<ActionResult<ItemMutationResult>> {
  return runAction(guard('excludeItems'), async () => {
    const outcome = await excludeItems(await context('excludeItems'), input);
    revalidate();
    return outcome;
  });
}

/** 휴지통에서 되살리기 */
export async function restoreItemsAction(
  input: ItemTargetsInput,
): Promise<ActionResult<ItemMutationResult>> {
  return runAction(guard('restoreItems'), async () => {
    const outcome = await restoreItems(await context('restoreItems'), input);
    revalidate();
    return outcome;
  });
}

/** 편집 — 행 편집(전 칸)·일괄 변경(제품·세부분류)·검토 카드 행 내 제품/세부분류 */
export async function editItemsAction(
  input: EditItemsInput,
): Promise<ActionResult<ItemMutationResult>> {
  return runAction(guard('editItems'), async () => {
    const outcome = await editItems(await context('editItems'), input);
    revalidate();
    return outcome;
  });
}

/** 단건 직접 추가 (source = manual) */
export async function addItemAction(
  input: AddItemInput,
): Promise<ActionResult<ItemMutationResult>> {
  return runAction(guard('addItem'), async () => {
    const outcome = await addItem(await context('addItem'), input);
    revalidate();
    return outcome;
  });
}
