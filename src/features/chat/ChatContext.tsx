'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/** 챗봇 패널 열림 상태 — 헤더 버튼(ChatLauncher)·패널이 함께 쓴다 (디자인 chatOpen / goChatbot). 진입점은 헤더 버튼 하나 (#30) */
type ChatContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** 헤더 챗봇 버튼 — 패널을 ×·Escape 로 닫으면 포커스를 여기로 돌려준다 (#30) */
  launcherRef: RefObject<HTMLButtonElement | null>;
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
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const value = useMemo(
    () => ({ isOpen, open, close, toggle, launcherRef, statusEndpoint }),
    [isOpen, open, close, toggle, statusEndpoint],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatPanel(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChatPanel 은 ChatProvider 안에서만 쓸 수 있습니다');
  return value;
}
