import { getDb } from '@/db';
import { parseAdminItemsFilter } from '@/lib/procurement/admin-items-filter';
import type { SessionUser } from '@/server/auth/session-user';
import type { ProcurementAccess } from '@/server/procurement/access';
import {
  getAdminItemRows,
  getItemDetailOptions,
  getItemReviewQueue,
  getItemTrash,
} from '@/server/procurement/admin-items';

import { ItemsAdminPanel } from './ItemsAdminPanel';

export type ItemsAdminSectionProps = {
  /** 페이지 searchParams (이미 await 된 값) */
  params: Record<string, string | string[] | undefined>;
  /** write 범위 조달 토큰 (requireProcurementPage('/admin/procurement', 'write')) */
  access: ProcurementAccess;
  /** 세션 사용자 — 섹션 공통 시그니처(지금은 쓰지 않는다) */
  user: SessionUser;
};

/**
 * 조달 관리 › 품목 관리 탭 (조달이 통합 UI-7) — 서버 섹션. URL(`?tab=items&q&product&page&trashPage&sort&dir`)을
 * admin-items-filter 로 파싱해 검토 대기·등록 품목 한 페이지·휴지통 한 페이지·세부분류 제안을 서버에서 불러온다.
 * 쓰기는 클라이언트 패널의 서버 액션 → router.refresh() 로 이 섹션이 다시 그려진다.
 */
export async function ItemsAdminSection({ params, access }: ItemsAdminSectionProps) {
  const filter = parseAdminItemsFilter(params);
  const db = await getDb();
  const [queue, registered, trash, detailOptions] = await Promise.all([
    getItemReviewQueue(access, db),
    getAdminItemRows(access, db, filter),
    getItemTrash(access, db, filter.trashPage),
    getItemDetailOptions(access, db),
  ]);
  return <ItemsAdminPanel filter={filter} data={{ queue, registered, trash, detailOptions }} />;
}
