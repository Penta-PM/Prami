import type { Metadata } from 'next';

import { ChatPage } from '@/features/chat/ChatPage';
import { CHAT_PAGE_COPY } from '@/features/chat/copy';
import { requirePagePermission } from '@/server/auth/rbac';

const COPY = CHAT_PAGE_COPY.procurement;

export const metadata: Metadata = { title: COPY.title };

/**
 * 조달 챗봇 (UX PR-C2, chat.use + procurement.read — 메뉴·화면·API 세 곳 모두 같은 두 권한, §4.2).
 * 답은 조달 domain 그래프(PR-C3 — 조달 조회 도구 4종·조달 프롬프트, 읽기 전용)가 만든다. 권한을 잃으면 메뉴는 숨고 이 화면은
 * 거부(redirect)되며 API 도 목록·열람·전송을 거부한다(대화는 지우지 않음).
 */
export default async function ProcurementChatPage() {
  await requirePagePermission('chat.use', COPY.path);
  await requirePagePermission('procurement.read', COPY.path);
  return <ChatPage domain="procurement" />;
}
