'use client';

import { m } from 'motion/react';

import { Presence } from '@/components/motion/Presence';
import { PRESS_CLASSES } from '@/components/ui/button';
import { Icon } from '@/features/shell/icons';
import { cn } from '@/lib/cn';
import { scaleIn, VARIANT_KEYS } from '@/lib/motion/tokens';

import { useChatPanel } from './ChatContext';
import { ChatPanel } from './ChatPanel';

/** 앱 셸에 붙는 챗봇: 우하단 플로팅 버튼(디자인) + 패널. 헤더 버튼은 ChatLauncher */
export function ChatDock() {
  const { isOpen, toggle } = useChatPanel();
  return (
    <>
      <ChatPanel />
      {/* 패널과 교대로 scale/fade (Motion 도입 스펙 §3.3 챗 패널). press 는 CSS(PRESS_CLASSES) */}
      <Presence>
        {isOpen ? null : (
          <m.button
            key="chat-fab"
            type="button"
            aria-label="챗봇 열기"
            title="가격정책 챗봇"
            onClick={toggle}
            variants={scaleIn}
            initial={VARIANT_KEYS.initial}
            animate={VARIANT_KEYS.animate}
            exit={VARIANT_KEYS.exit}
            className={cn(
              'fixed right-7 bottom-7 z-20 flex size-14 items-center justify-center rounded-circle border-0 bg-ink-900 text-white shadow-(--shadow-elevated)',
              PRESS_CLASSES,
            )}
          >
            <Icon name="chat" className="size-6" />
          </m.button>
        )}
      </Presence>
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
