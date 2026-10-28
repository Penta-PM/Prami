import type { Metadata } from 'next';

import { ChatPage } from '@/features/chat/ChatPage';
import { CHAT_PAGE_COPY } from '@/features/chat/copy';
import { requirePagePermission } from '@/server/auth/rbac';

const COPY = CHAT_PAGE_COPY.pricing;

export const metadata: Metadata = { title: COPY.title };

/**
 * 가격 정책 챗봇 (UX PR-C2, chat.use): 저장 대화 목록 + 대화창. 대화 id 는 URL `?c=` — 클라이언트가 DB 에서 읽는다.
 * 사이드바 "가격 정책" 섹션 아래 메뉴. 헤더 챗봇 버튼·도킹 패널은 이 화면으로 대체됐다.
 */
export default async function PricingChatPage() {
  await requirePagePermission('chat.use', COPY.path);
  return <ChatPage domain="pricing" />;
}
