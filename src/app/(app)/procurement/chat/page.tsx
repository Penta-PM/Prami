import type { Metadata } from 'next';

import { ChatPage } from '@/features/chat/ChatPage';
import { CHAT_PAGE_COPY } from '@/features/chat/copy';
import { requirePagePermission } from '@/server/auth/rbac';

const COPY = CHAT_PAGE_COPY.procurement;

export const metadata: Metadata = { title: COPY.title };

/**
 * 조달 챗봇 (UX PR-C2, chat.use + procurement.read — 메뉴·화면·API 세 곳 모두 같은 두 권한, §4.2).
 * 조달 대화의 답(도구·프롬프트)은 PR-C3 이 붙인다 — 그전에는 서버가 전송을 거부하고("조달 챗봇은 아직 준비 중입니다")
 * 화면은 그 문구를 오류 말풍선으로 그대로 보여 준다(꾸며 낸 답 없음). 목록·새 대화·이름 바꾸기·삭제는 동작한다.
 */
export default async function ProcurementChatPage() {
  await requirePagePermission('chat.use', COPY.path);
  await requirePagePermission('procurement.read', COPY.path);
  return <ChatPage domain="procurement" />;
}
