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
  /** 여는 의도 (런처 aria-pressed). 알림 드롭다운이 화면에 있으면 패널은 그 퇴장이 끝난 뒤 그려진다 */
  isOpen: boolean;
  /** 패널을 그리는지 — 여는 의도이고 알림 드롭다운이 화면에 없을 때 (#31 Q1 반대 방향 A) */
  isShown: boolean;
  /** 패널이 화면에 있는지 — 그리는 중이거나 퇴장 애니메이션 중. 알림 드롭다운은 이것이 false 가 된 뒤에 연다 (#31 Q1 A) */
  isVisible: boolean;
  /** 패널 Presence 의 퇴장이 끝났을 때 ChatPanel 이 부른다 */
  onPanelExitComplete: () => void;
  /** 알림 드롭다운이 화면에 있는지(열림·퇴장 중) — NotificationBell 이 알린다 */
  setOverlayVisible: (visible: boolean) => void;
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
  const [overlayVisible, setOverlayVisible] = useState(false);
  const isShown = isOpen && !overlayVisible;
  // 퇴장까지 끝나 화면에서 사라졌는지. 그리기 시작하면 false(렌더 중 조정), 패널 퇴장 완료 시 true
  const [exited, setExited] = useState(!initialOpen);
  if (isShown && exited) setExited(false);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const onPanelExitComplete = useCallback(() => setExited(true), []);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const isVisible = isShown || !exited;
  const value = useMemo(
    () => ({
      isOpen,
      isShown,
      isVisible,
      onPanelExitComplete,
      setOverlayVisible,
      open,
      close,
      toggle,
      launcherRef,
      statusEndpoint,
    }),
    [isOpen, isShown, isVisible, onPanelExitComplete, open, close, toggle, statusEndpoint],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatPanel(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('useChatPanel 은 ChatProvider 안에서만 쓸 수 있습니다');
  return value;
}
