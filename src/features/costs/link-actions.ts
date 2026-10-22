'use server';

import { revalidatePath } from 'next/cache';

import { getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import { AUDIT_COST_READ, requireCostAccess } from '@/server/cost/access';
import {
  applyCostLinkImport,
  AUDIT_COST_LINK_IMPORT,
  previewCostLinkImport,
} from '@/server/cost/item-link-import';
import {
  AUDIT_COST_LINK_DELETE,
  AUDIT_COST_LINK_UPSERT,
  confirmCostLinks,
  deleteCostLink,
  getCostLinkPicker,
} from '@/server/cost/item-links';
import type {
  ApplyCostLinkImportInput,
  ApplyCostLinkImportResult,
  ConfirmCostLinksInput,
  ConfirmCostLinksResult,
  CostLinkImportInput,
  CostLinkImportPreview,
  CostLinkPickerData,
  DeleteCostLinkInput,
  DeleteCostLinkResult,
} from '@/server/cost/item-link-types';

/**
 * 원가 매핑 Server Actions (스펙 cost-ratio-price-change §2.1). 수정은 `cost.write`, 거부 시 FORBIDDEN 봉투 + 감사 denied.
 * 응답에 원가 금액은 없다(건수만).
 */
const LINKS_PATH = '/admin/costs/links';
/** 가격정책 관리 표의 원가 매핑·원가 비중 열도 같은 매핑으로 계산된다 (policy-cost-link-column §2.3-6) */
const POLICIES_PATH = '/admin/policies';

function revalidateLinkScreens() {
  revalidatePath(LINKS_PATH);
  revalidatePath(POLICIES_PATH);
}

async function context(target: string) {
  return {
    handle: await getDbHandle(),
    access: await requireCostAccess('write', target),
    meta: await currentRequestMeta(),
  };
}

/** 확정(단건·일괄). 제안은 저장되지 않으므로 화면이 확정한 쌍만 보낸다 */
export async function confirmCostLinksAction(
  input: ConfirmCostLinksInput,
): Promise<ActionResult<ConfirmCostLinksResult>> {
  const guard = {
    permission: 'cost.write',
    auditAction: AUDIT_COST_LINK_UPSERT,
    name: 'confirmCostLinks',
  } as const;
  return runAction(guard, async () => {
    const result = await confirmCostLinks(await context('action:confirmCostLinks'), input);
    revalidateLinkScreens();
    return result;
  });
}

/** 매핑 해제(고아 링크 포함) */
export async function deleteCostLinkAction(
  input: DeleteCostLinkInput,
): Promise<ActionResult<DeleteCostLinkResult>> {
  const guard = {
    permission: 'cost.write',
    auditAction: AUDIT_COST_LINK_DELETE,
    name: 'deleteCostLink',
  } as const;
  return runAction(guard, async () => {
    const result = await deleteCostLink(await context('action:deleteCostLink'), input);
    revalidateLinkScreens();
    return result;
  });
}

/**
 * 가격정책 관리 매핑 수정 모달이 열릴 때 1회 (policy-cost-link-column §2.3-2): 품목 요약·현재 매핑·제안·자재 목록·영향 건수.
 * `cost.read`, 거부 시 FORBIDDEN 봉투 + 감사 cost.read denied. 원가 금액 없음
 */
export async function loadCostLinkPickerAction(input: {
  itemCode: string;
}): Promise<ActionResult<CostLinkPickerData>> {
  const guard = {
    permission: 'cost.read',
    auditAction: AUDIT_COST_READ,
    name: 'loadCostLinkPicker',
  } as const;
  return runAction(guard, async () => {
    const access = await requireCostAccess('read', 'action:loadCostLinkPicker');
    const handle = await getDbHandle();
    return getCostLinkPicker(access, handle.db, input?.itemCode);
  });
}

/**
 * 품목-원가 매칭 파일 미리보기 (erp-upload-guide §6.2-3): 브라우저가 읽은 {품목코드, 자재번호} 쌍만 받는다. 쓰기 없음,
 * 결과는 응답에만. 매칭 업로드는 cost.write 화면이므로 `cost.write`(거부 시 FORBIDDEN + cost_link.import denied).
 */
export async function previewCostLinkImportAction(
  input: CostLinkImportInput,
): Promise<ActionResult<CostLinkImportPreview>> {
  const guard = {
    permission: 'cost.write',
    auditAction: AUDIT_COST_LINK_IMPORT,
    name: 'previewCostLinkImport',
  } as const;
  return runAction(guard, async () => {
    const access = await requireCostAccess('write', 'action:previewCostLinkImport');
    const handle = await getDbHandle();
    return previewCostLinkImport(access, handle.db, input);
  });
}

/**
 * 품목-원가 매칭 파일 확정 (§6.2-5): 변경·추가만 저장(행별 감사 = 수동 확정과 같음) + 요약 감사 1건(건수만). 해제 없음.
 * 미리보기 이후 데이터가 바뀌었으면 CONFLICT(details.stale) — 화면이 '다시 미리보기'를 안내한다.
 */
export async function applyCostLinkImportAction(
  input: ApplyCostLinkImportInput,
): Promise<ActionResult<ApplyCostLinkImportResult>> {
  const guard = {
    permission: 'cost.write',
    auditAction: AUDIT_COST_LINK_IMPORT,
    name: 'applyCostLinkImport',
  } as const;
  return runAction(guard, async () => {
    const result = await applyCostLinkImport(await context('action:applyCostLinkImport'), input);
    revalidateLinkScreens();
    return result;
  });
}
