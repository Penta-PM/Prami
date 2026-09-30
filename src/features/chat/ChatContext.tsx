'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** 챗봇 패널 열림 상태 — 헤더 버튼·플로팅 버튼·패널이 함께 쓴다 (디자인 chatOpen / goChatbot) */
type ChatContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** 설정되면 패널이 열릴 때·포커스 복귀 시 LLM 연결 상태를 조회한다 (PRAMI-002 §4.9) */
  statusEndpoint?: string;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({
  children,
  initialOpen = false,
  statusEndpoint,
}: {
  children: ReactNode;
  initialOpen?: boolean;
  statusEndpoint?: string;
}) {
  const [isOpen, setOpen] = useState(initialOpen);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const value = useMemo(
    () => ({ isOpen, open, close, toggle, statusEndpoint }),
    [isOpen, open, close, toggle, statusEndpoint],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatPanel(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChatPanel 은 ChatProvider 안에서만 쓸 수 있습니다');
  return value;
}
