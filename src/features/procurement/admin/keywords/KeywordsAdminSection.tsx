import { getDb } from '@/db';
import type { SessionUser } from '@/server/auth/session-user';
import type { ProcurementAccess } from '@/server/procurement/access';
import { getBidKeywordBoard } from '@/server/procurement/keywords';

import { KeywordAdminPanel } from './KeywordAdminPanel';

export type KeywordsAdminSectionProps = {
  /** 페이지 searchParams (키워드 탭은 탭 안 조건이 없다 — 공용 시그니처) */
  params: Record<string, string | string[] | undefined>;
  /** write 범위 토큰 (페이지 가드 requireProcurementPage(…, 'write')) */
  access: ProcurementAccess;
  user: SessionUser;
};

/**
 * 키워드 관리 탭 내용 (조달이 통합 UI-8) — RSC 가 키워드 전체 + 마지막 확인 시각(getCollectionStatus)을 서버에서 읽어
 * 클라이언트 칩 편집기에 넘긴다. 추가·삭제 뒤에는 편집기가 router.refresh() 로 이 컴포넌트를 다시 읽는다.
 */
export async function KeywordsAdminSection({ access }: KeywordsAdminSectionProps) {
  const board = await getBidKeywordBoard(access, await getDb());
  return <KeywordAdminPanel board={board} />;
}
