import 'server-only';

import { getDb } from '@/db';
import {
  parseAdminDeliveriesView,
  toDeliveryListQuery,
} from '@/lib/procurement/admin-deliveries-filter';
import type { SessionUser } from '@/server/auth/session-user';
import type { ProcurementAccess } from '@/server/procurement/access';
import { getDeliveryAdminFacets, getDeliveryAdminRows } from '@/server/procurement/deliveries';

import { DeliveriesAdmin } from './DeliveriesAdmin';

type Params = Record<string, string | string[] | undefined>;

export type DeliveriesAdminSectionProps = {
  params: Params;
  /** procurement.write 토큰 (관리 페이지 가드 requireProcurementPage(…, 'write') 가 준 것) */
  access: ProcurementAccess;
  user: SessionUser;
};

/**
 * 조달 관리 · 실적 관리 탭 내용 (조달이 통합 UI-6) — RSC. URL(`tab=deliveries&trash&q&f.*&page&sort&dir`)을 화면과 같은 코덱으로
 * 파싱해 서버에서 한 페이지를 읽고 클라이언트 표에 넘긴다. 제품·납품업체 선택지(데이터)가 화이트리스트에 들어가므로 facets 를 먼저 읽는다.
 */
export async function DeliveriesAdminSection({
  params,
  access,
  user,
}: DeliveriesAdminSectionProps) {
  const db = await getDb();
  const trash = parseAdminDeliveriesView(params).trash;
  const facets = await getDeliveryAdminFacets(access, db, trash ? 'trash' : 'active');
  const view = parseAdminDeliveriesView(params, facets);
  const result = await getDeliveryAdminRows(access, db, toDeliveryListQuery(view));
  return (
    <DeliveriesAdmin
      rows={result.rows}
      // 범위를 넘은 page 는 조회 계층이 마지막 페이지로 맞춘다 — 링크·정렬도 그 페이지 기준
      view={{ ...view, page: result.page }}
      total={result.total}
      pageCount={result.pageCount}
      trashCount={result.trashCount}
      choices={facets}
      userId={user.id}
    />
  );
}
