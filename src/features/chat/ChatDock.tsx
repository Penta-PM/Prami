'use client';

import { Icon } from '@/features/shell/icons';

import { useChatPanel } from './ChatContext';
import { ChatPanel } from './ChatPanel';

/** 앱 셸에 붙는 챗봇: 우하단 플로팅 버튼(디자인) + 패널. 헤더 버튼은 ChatLauncher */
export function ChatDock() {
  const { isOpen, toggle } = useChatPanel();
  return (
    <>
      <ChatPanel />
      {isOpen ? null : (
        <button
          type="button"
          aria-label="챗봇 열기"
          title="가격정책 챗봇"
          onClick={toggle}
          className="fixed right-7 bottom-7 z-20 flex size-14 items-center justify-center rounded-circle border-0 bg-ink-900 text-white shadow-(--shadow-elevated)"
        >
          <Icon name="chat" className="size-6" />
        </button>
      )}
    </>
  );
}

/** 헤더의 챗봇 아이콘 버튼 (디자인 goChatbot 토글) */
export function ChatLauncher() {
  const { isOpen, toggle } = useChatPanel();
  return (
    <button
      type="button"
      title="챗봇"
      aria-label="챗봇"
      aria-pressed={isOpen}
      onClick={toggle}
      className="flex size-9 items-center justify-center rounded-pill border-0 bg-gray-75 text-text-secondary shadow-(--hairline-subtle) hover:text-ink-900 aria-pressed:text-ink-900"
    >
      <Icon name="chat" className="size-4" />
    </button>
  );
}
