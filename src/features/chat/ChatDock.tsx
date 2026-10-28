'use client';

import { Icon } from '@/components/icons/Icon';

import { useChatPanel } from './ChatContext';
import { ChatPanel } from './ChatPanel';

/** 앱 셸에 붙는 챗봇 패널. 여는 곳은 헤더의 ChatLauncher 하나다 — 우하단 플로팅 버튼은 목록 하단 버튼을 가려 제거했다 (#30) */
export function ChatDock() {
  return <ChatPanel />;
}

/** 헤더의 챗봇 아이콘 버튼 (디자인 goChatbot 토글) */
export function ChatLauncher() {
  const { isOpen, toggle, launcherRef } = useChatPanel();
  return (
    <button
      ref={launcherRef}
      type="button"
      title="챗봇"
      aria-label="챗봇"
      aria-pressed={isOpen}
      onClick={toggle}
      className="flex size-9 items-center justify-center rounded-pill border-0 bg-gray-75 text-text-secondary shadow-(--hairline-subtle) hover:text-ink-900 aria-pressed:text-ink-900"
    >
      <Icon name="message" />
    </button>
  );
}
