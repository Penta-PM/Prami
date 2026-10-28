import { getDb } from '@/db';
import type { SessionUser } from '@/server/auth/session-user';
import type { ProcurementAccess } from '@/server/procurement/access';
import { getMailReportBoard } from '@/server/procurement/mail-recipients';

import { MailAdminPanel } from './MailAdminPanel';

export type MailAdminSectionProps = {
  /** 페이지 searchParams (메일 보고 탭은 탭 안 조건이 없다 — 공용 시그니처) */
  params: Record<string, string | string[] | undefined>;
  /** write 범위 토큰 (페이지 가드 requireProcurementPage(…, 'write')) */
  access: ProcurementAccess;
  user: SessionUser;
};

/**
 * 메일 보고 탭 내용 (수집기 Prami 이전 §3.1) — RSC 가 수신처 전체 + 상태 카드(마지막 일일 보고·보고 기준일)를 서버에서 읽어
 * 클라이언트 편집기에 넘긴다. 추가·삭제 뒤에는 편집기가 router.refresh() 로 이 컴포넌트를 다시 읽는다.
 */
export async function MailAdminSection({ access }: MailAdminSectionProps) {
  const board = await getMailReportBoard(access, await getDb());
  return <MailAdminPanel board={board} />;
}
