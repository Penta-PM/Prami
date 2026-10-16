'use client';

import { m, useIsPresent } from 'motion/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

import { Presence } from '@/components/motion/Presence';
import { cn } from '@/lib/cn';
import { scaleIn, VARIANT_KEYS } from '@/lib/motion/tokens';

export type PopoverAlign = 'start' | 'end';

export type PopoverProps = {
  /** 제어형 — 열림 여부 */
  open: boolean;
  /** 팝오버 스스로 닫을 때(Esc·바깥 클릭·Tab 이탈) `false` 로 호출된다. 트리거 토글은 호출자가 처리한다 */
  onOpenChange: (open: boolean) => void;
  /** 트리거 요소. 위치 기준이자 Esc 후 포커스 복귀 대상이며, 이 요소의 클릭은 바깥 클릭으로 보지 않는다 */
  anchorRef: RefObject<HTMLElement | null>;
  /** 접근성 이름 — 예: "품목명 필터" */
  label: string;
  /** 트리거 기준 가로 정렬. start = 왼쪽 맞춤, end = 오른쪽 맞춤 (기본 start) */
  align?: PopoverAlign;
  /** 열릴 때 포커스할 요소. 없으면 첫 입력/선택/버튼, 그것도 없으면 팝오버 자신 */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
};

/** 열릴 때 첫 포커스 후보 — 입력 계열을 버튼보다 먼저 찾는다 (스펙 §2.5-5 "첫 입력 포커스") */
const INPUT_SELECTOR =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';
const FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** 화면 가장자리 여백(px) — 폭 min(320px, 100vw - 32px) 와 같은 값 */
const GUTTER = 16;
const MAX_WIDTH = 320;
/** 트리거와 팝오버 사이 간격(px) */
const OFFSET = 8;

type Position = { top: number; left: number; placement: 'bottom' | 'top' };

/**
 * 비모달 팝오버 프리미티브 (표 열 필터 스펙 §2.5-5). 트리거는 호출자가 렌더한다
 * (`aria-haspopup="dialog"`, `aria-expanded={open}`, onClick 으로 토글).
 *
 * - `role="dialog"` + `aria-label`, `aria-modal` 없음 — 포커스 트랩 없음.
 * - 위치: `position: fixed` 로 트리거 아래(공간이 모자라면 위)에 놓고, 가로는 화면 안으로 고정한다(좌우 16px 여백).
 *   표 컨테이너의 overflow 에 잘리지 않게 fixed 를 쓴다. 포털을 쓰지 않으므로 Modal(<dialog>) 안에서는 같은 top layer 에 남는다.
 *   z-40: 표 sticky 헤더(z-10)·챗 패널(z-30) 위, 페이지 레벨 Modal·Drawer(z-50) 아래.
 * - Esc: 팝오버만 닫고 트리거로 포커스 복귀. keydown 의 기본 동작·전파를 막아 바깥 <dialog> 의 cancel(모달 닫힘)이
 *   일어나지 않는다. 같은 키 입력에서 cancel 이 오더라도 한 틱 동안 가로채 막는다(브라우저 차이 대비).
 * - 바깥 클릭(터치 포함 — click 은 탭에도 발생)·Tab 이탈 시 닫힌다. 트리거 클릭은 무시해 호출자의 토글과 겹치지 않는다.
 * - 모션: scaleIn (MotionProvider 의 reducedMotion="user" 로 감속 모드 준수). 퇴장 중에는 이벤트를 처리하지 않는다.
 */
export function Popover(props: PopoverProps) {
  return <Presence>{props.open ? <PopoverPanel key="popover" {...props} /> : null}</Presence>;
}

function PopoverPanel({
  onOpenChange,
  anchorRef,
  label,
  align = 'start',
  initialFocusRef,
  className,
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isPresent = useIsPresent();
  const [position, setPosition] = useState<Position | null>(null);

  // 최신 콜백을 effect 재구독 없이 참조한다
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const close = useCallback(() => onOpenChangeRef.current(false), []);
  const closeAndRestoreFocus = useCallback(() => {
    onOpenChangeRef.current(false);
    const anchor = anchorRef.current;
    if (anchor?.isConnected) anchor.focus();
  }, [anchorRef]);

  // 위치 계산 — 페인트 전에 한 번, 이후 스크롤(모든 스크롤 컨테이너, 캡처)·리사이즈마다
  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(MAX_WIDTH, window.innerWidth - GUTTER * 2);
    const preferred = align === 'end' ? rect.right - width : rect.left;
    const left = Math.max(GUTTER, Math.min(preferred, viewportWidth - GUTTER - width));

    const height = panelRef.current?.offsetHeight ?? 0;
    const spaceBelow = viewportHeight - rect.bottom - OFFSET - GUTTER;
    const spaceAbove = rect.top - OFFSET - GUTTER;
    const placement = height > spaceBelow && spaceAbove > spaceBelow ? 'top' : 'bottom';
    const top =
      placement === 'bottom' ? rect.bottom + OFFSET : Math.max(GUTTER, rect.top - OFFSET - height);

    setPosition((prev) =>
      prev && prev.top === top && prev.left === left && prev.placement === placement
        ? prev
        : { top, left, placement },
    );
  }, [anchorRef, align]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    if (!isPresent) return;
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isPresent, updatePosition]);

  // 열리면 첫 입력(없으면 첫 포커스 가능 요소, 그것도 없으면 팝오버 자신)으로 포커스
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const target =
      initialFocusRef?.current ??
      panel.querySelector<HTMLElement>(INPUT_SELECTOR) ??
      panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      panel;
    target.focus();
    // 마운트 시 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 바깥 클릭 닫기 (캡처 — 하위에서 전파를 막아도 받는다). 트리거 클릭은 호출자 토글에 맡긴다.
  // 클릭으로 다른 컨트롤에 포커스가 갔으면 빼앗지 않고, 아니면(빈 곳) 트리거로 돌려준다 (NotificationBell 패턴)
  useEffect(() => {
    if (!isPresent) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      const active = document.activeElement;
      const focusElsewhere =
        active && active !== document.body && !panelRef.current?.contains(active);
      if (focusElsewhere) close();
      else closeAndRestoreFocus();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [isPresent, anchorRef, close, closeAndRestoreFocus]);

  // 트리거에서 Tab 으로 팝오버도 아닌 곳으로 나가면 닫는다 (팝오버 쪽 이탈은 onBlur 에서)
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!isPresent || !anchor) return;
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !panelRef.current?.contains(next) && !anchor.contains(next)) close();
    };
    anchor.addEventListener('focusout', onFocusOut);
    return () => anchor.removeEventListener('focusout', onFocusOut);
  }, [isPresent, anchorRef, close]);

  // Esc — 네이티브 리스너로 패널에서 전파를 끊는다. React 합성 stopPropagation 은 이미 네이티브로 버블된 뒤라
  // 바깥 <dialog>·조상 요소의 네이티브 리스너를 막지 못한다. 기본 동작(바깥 <dialog> 의 cancel)도 막는다 — 모달 유지.
  // 그래서 팝오버 안 자식의 Escape 는 버블 단계 React 핸들러에 닿지 않는다(Escape 는 팝오버 몫).
  useEffect(() => {
    const panel = panelRef.current;
    if (!isPresent || !panel) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      suppressDialogCancelOnce();
      closeAndRestoreFocus();
    };
    panel.addEventListener('keydown', onKeyDown);
    return () => panel.removeEventListener('keydown', onKeyDown);
  }, [isPresent, closeAndRestoreFocus]);

  const style: CSSProperties = position
    ? {
        top: position.top,
        left: position.left,
        transformOrigin: `${position.placement === 'bottom' ? 'top' : 'bottom'} ${align === 'end' ? 'right' : 'left'}`,
      }
    : // 첫 커밋 직후 레이아웃 effect 가 페인트 전에 위치를 채운다. visibility:hidden 은 쓰지 않는다 — 초기 포커스가 실패한다
      { top: 0, left: 0 };

  return (
    <m.div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-placement={position?.placement}
      variants={scaleIn}
      initial={VARIANT_KEYS.initial}
      animate={VARIANT_KEYS.animate}
      exit={VARIANT_KEYS.exit}
      style={style}
      onBlur={(event) => {
        // Tab 으로 팝오버를 벗어나면 닫는다. 트리거로 간 경우(Shift+Tab·트리거 누름)는 호출자 토글에 맡긴다.
        // relatedTarget 이 없으면(빈 곳 클릭·창 전환) 바깥 클릭 처리에 맡긴다
        if (!isPresent) return;
        const next = event.relatedTarget as Node | null;
        if (!next || event.currentTarget.contains(next)) return;
        if (anchorRef.current?.contains(next)) return;
        close();
      }}
      className={cn(
        'fixed z-40 max-h-[calc(100vh-32px)] w-[min(320px,calc(100vw-32px))] overflow-auto rounded-xl bg-surface-card p-4 text-ink-900 shadow-(--shadow-elevated) outline-none',
        !isPresent && 'pointer-events-none',
        className,
      )}
    >
      {children}
    </m.div>
  );
}

/**
 * 같은 Esc 입력에서 바깥 <dialog> 의 cancel 이 오면 막는다. 대부분의 브라우저는 keydown preventDefault 로 cancel 을 내지 않지만,
 * close watcher 구현 차이에 대비해 다음 태스크까지만 window 캡처 단계에서 가로챈다(대상 dialog 의 onCancel 에 닿지 않음).
 */
function suppressDialogCancelOnce() {
  const onCancel = (event: Event) => {
    if (!(event.target instanceof HTMLDialogElement)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('cancel', onCancel, true);
  setTimeout(() => window.removeEventListener('cancel', onCancel, true), 0);
}
