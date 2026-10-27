'use server';

import { getDbHandle } from '@/db';
import type { ActionResult } from '@/lib/result';
import { currentRequestMeta } from '@/server/audit/request-meta';
import { runAction } from '@/server/auth/rbac';
import { requireProcurementAccess } from '@/server/procurement/access';
import {
  addBidKeyword,
  AUDIT_PROCUREMENT_KEYWORD_ADD,
  AUDIT_PROCUREMENT_KEYWORD_DELETE,
  deleteBidKeyword,
  type AddBidKeywordInput,
  type BidKeywordView,
  type DeleteBidKeywordInput,
} from '@/server/procurement/keywords';

/**
 * 키워드 관리 Server Actions (조달이 통합 UI-8, procurement.write = ADMIN). 거부(§4.7.1): FORBIDDEN 봉투 + 감사 denied
 * (action = 시도한 행위 키 procurement.keyword.add|delete) + 변경 없음.
 * 목록 조회는 RSC(KeywordsAdminSection)가 한다. 변경과 감사는 server/procurement/keywords 에서 한 트랜잭션.
 */
async function writeContext(target: string) {
  return {
    access: await requireProcurementAccess('write', target),
    handle: await getDbHandle(),
    meta: await currentRequestMeta(),
  };
}

export async function addBidKeywordAction(
  input: AddBidKeywordInput,
): Promise<ActionResult<BidKeywordView>> {
  const guard = {
    permission: 'procurement.write',
    auditAction: AUDIT_PROCUREMENT_KEYWORD_ADD,
    name: 'addBidKeyword',
  } as const;
  return runAction(guard, async () =>
    addBidKeyword(await writeContext('action:addBidKeyword'), input),
  );
}

export async function deleteBidKeywordAction(
  input: DeleteBidKeywordInput,
): Promise<ActionResult<BidKeywordView>> {
  const guard = {
    permission: 'procurement.write',
    auditAction: AUDIT_PROCUREMENT_KEYWORD_DELETE,
    name: 'deleteBidKeyword',
  } as const;
  return runAction(guard, async () =>
    deleteBidKeyword(await writeContext('action:deleteBidKeyword'), input),
  );
}
