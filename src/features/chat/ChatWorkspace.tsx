'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import type { ChatDomain } from '@/lib/chat/conversations';
import { cn } from '@/lib/cn';

import { ConversationList } from './ConversationList';
import { ConversationPane } from './ConversationPane';
import { CHAT_PAGE_COPY, UNTITLED_CONVERSATION } from './copy';
import { useChatStatus } from './useChatStatus';
import { useConversationList } from './useConversationList';
import { useConversationThread } from './useConversationThread';

/**
 * 챗봇 화면 본문 (UX PR-C2 §4.2 — 가격 정책 챗봇 `/pricing/chat`, 조달 챗봇 `/procurement/chat`, domain 으로 구분).
 * 데스크톱: 왼쪽 대화 목록(≈260px) + 오른쪽 대화창. 768px 미만: 목록 또는 대화 한 화면씩(대화창의 "대화 목록" 버튼으로 돌아감).
 * URL `?c=<대화 id>` 가 상태다 — 대화 고르기·새 대화·목록으로 = router.push(뒤로 가기로 돌아옴), 첫 질문으로 만든 대화 id 반영·
 * 지금 연 대화 삭제 = router.replace(기록을 쌓지 않음). 새로고침·딥 링크·"계산기에서 열기" 뒤 돌아오기는 `?c=` 로 DB 에서 복원한다.
 * 대화 내용은 브라우저 저장소에 두지 않는다(서버 DB 만 — I-6 개정).
 */
export const CHAT_STATUS_ENDPOINT = '/api/chat/status';

export function ChatWorkspace({ domain }: { domain: ChatDomain }) {
  const copy = CHAT_PAGE_COPY[domain];
  const router = useRouter();
  const pathname = usePathname() ?? copy.path;
  const searchParams = useSearchParams();
  const selectedId = searchParams?.get('c') || null;
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  /** 좁은 화면에서 `?c=` 없이 대화창(새 대화)을 보고 있는지 */
  const [draftOpen, setDraftOpen] = useState(false);

  const list = useConversationList(domain);
  const { status, applyLlm } = useChatStatus(CHAT_STATUS_ENDPOINT, true);
  const hrefFor = useCallback(
    (id: string) => `${pathname}?c=${encodeURIComponent(id)}`,
    [pathname],
  );
  const { refresh } = list;
  const thread = useConversationThread({
    domain,
    conversationId: selectedId,
    status,
    applyLlm,
    onCreated: (id) => {
      router.replace(hrefFor(id), { scroll: false });
      void refresh();
    },
    onSettled: () => void refresh(),
  });

  const selectConversation = (id: string) => {
    if (id !== selectedId) router.push(hrefFor(id), { scroll: false });
  };

  const startNew = () => {
    setDraftOpen(true);
    if (selectedId) router.push(pathname, { scroll: false });
    // 새 대화는 첫 질문을 보낼 때 만든다 — 입력창으로 포커스
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const backToList = () => {
    setDraftOpen(false);
    if (selectedId) router.push(pathname, { scroll: false });
  };

  const removeConversation = async (id: string) => {
    const result = await list.remove(id);
    if (result.ok && id === selectedId) router.replace(pathname, { scroll: false });
    return result;
  };

  const renameConversation = async (id: string, title: string) => {
    const result = await list.rename(id, title);
    return result.ok ? ({ ok: true } as const) : ({ ok: false, message: result.message } as const);
  };

  const current = thread.activeId
    ? list.items.find((item) => item.id === thread.activeId)
    : undefined;
  const title = current?.title ?? thread.title ?? UNTITLED_CONVERSATION;
  // 좁은 화면: 대화를 골랐거나 새 대화를 열었거나 목록이 비어 있으면 대화창, 아니면 목록
  const listEmpty = list.status === 'ready' && list.items.length === 0;
  const mobileView = selectedId || draftOpen || listEmpty ? 'conversation' : 'list';

  return (
    <div
      data-mobile-view={mobileView}
      className="flex min-h-[420px] flex-1 overflow-hidden rounded-card border border-border-subtle bg-surface-card shadow-(--shadow-card)"
    >
      <div
        data-testid="chat-list-column"
        className={cn(
          'flex w-[260px] shrink-0 flex-col border-r border-border-subtle bg-surface-page max-md:w-full max-md:border-r-0',
          mobileView === 'conversation' && 'max-md:hidden',
        )}
      >
        <ConversationList
          items={list.items}
          status={list.status}
          selectedId={selectedId}
          hrefFor={hrefFor}
          onSelect={selectConversation}
          onNew={startNew}
          onRetry={list.retry}
          onRename={renameConversation}
          onDelete={removeConversation}
          newButtonRef={newButtonRef}
        />
      </div>
      <div
        data-testid="chat-pane-column"
        className={cn('flex min-w-0 flex-1', mobileView === 'list' && 'max-md:hidden')}
      >
        <ConversationPane
          copy={copy}
          thread={thread}
          title={title}
          status={status}
          onBack={listEmpty ? undefined : backToList}
          composerRef={composerRef}
        />
      </div>
    </div>
  );
}
