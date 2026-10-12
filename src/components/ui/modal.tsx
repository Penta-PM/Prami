'use client';

import { m, usePresence } from 'motion/react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { cn } from '@/lib/cn';
import { scaleIn, VARIANT_KEYS } from '@/lib/motion/tokens';

import { PRESS_CLASSES } from './button';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/**
 * 닫힘 요청의 출처 (Motion 도입 스펙 §3.3 모달 — 퇴장 4경로).
 * - user: 닫기 버튼 · Esc(cancel) · 백드롭 클릭 → 퇴장 후 dialog.close() → close 이벤트에서 onClose 1회
 * - parent: 부모가 open=false → 퇴장 후 dialog.close(), onClose 는 호출하지 않음
 * - presence: <Presence> 아래에서 언마운트 → 퇴장 후 safeToRemove(), onClose 는 호출하지 않음
 */
type CloseReason = 'user' | 'parent' | 'presence';

/**
 * 네이티브 <dialog> 기반 모달. Esc·배경 클릭·닫기 버튼 모두 퇴장 애니메이션을 거쳐 dialog.close() 로 모이고,
 * 네이티브 close 이벤트 한 곳에서만 onClose 를 호출한다 (사용자 행동 1회 = onClose 1회).
 *
 * 모션 (Motion 도입 스펙 §3.3 모달): <dialog> 자체에는 transform 을 걸지 않고(top-layer·포커스 트랩 유지)
 * 내부 래퍼 m.div 가 scaleIn(0.96→1 + fade) 으로 진입·퇴장한다. 백드롭은 CSS 만 — 진입은 @starting-style,
 * 퇴장은 data-closing 속성으로 opacity 를 전환한다. 퇴장이 시작되면 패널은 pointer-events-none 이 되고
 * 포커스는 열었던 트리거로 즉시 돌아간다.
 */
export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  const titleId = useId();

  // 퇴장 상태 머신: closing 이 true 인 동안 m.div 가 'exit' 로 애니메이션하고, 완료 시 finishClose 가 마무리한다
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const reasonRef = useRef<CloseReason | null>(null);
  // 한 번의 열림(showModal) 당 onClose 는 1회만 — Esc 연타·브라우저 강제 close 등 중복 경로를 막는다
  const notifiedRef = useRef(false);
  // showModal 직전의 activeElement — 퇴장 시작 시점에 포커스를 돌려준다
  const triggerRef = useRef<HTMLElement | null>(null);
  // m.div 가 'exit' 애니메이션을 실제로 시작했는지 (아래 안전장치 effect 참고)
  const exitStartedRef = useRef(false);
  // 마지막 누름(pointerdown)이 패널 안(<dialog> 의 자손)에서 시작됐는지 — 백드롭 오인 닫힘 방지 (modal-backdrop-press-origin)
  const pressedInsideRef = useRef(false);

  // <Presence> 아래에 있으면 언마운트가 isPresent=false 로 먼저 도착한다. 바깥에서는 항상 [true]
  const [isPresent, safeToRemove] = usePresence();
  const isPresentRef = useRef(isPresent);
  const safeToRemoveRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    isPresentRef.current = isPresent;
    safeToRemoveRef.current = safeToRemove ?? null;
  }, [isPresent, safeToRemove]);

  const restoreFocus = useCallback(() => {
    const trigger = triggerRef.current;
    // 모달이 열려 있는 동안 바깥은 inert 라 브라우저에서는 close() 뒤에야 실제로 옮겨진다 — 두 시점 모두 시도한다
    if (trigger && trigger.isConnected && document.activeElement !== trigger) trigger.focus();
  }, []);

  const beginClose = useCallback(
    (reason: CloseReason) => {
      if (closingRef.current) return; // 퇴장 중 중복 요청(Esc 연타 등)은 무시
      closingRef.current = true;
      reasonRef.current = reason;
      // exitStartedRef 는 여기서 지우지 않는다 — 부모가 open=false 로 닫으면 이 호출보다 먼저 패널이 'exit' 를 시작하는데
      // (open=false 렌더), 지우면 같은 목표('exit')라 시작 콜백이 다시 오지 않아 안전장치가 즉시 닫아 버린다 (QA #35 CRITICAL)
      restoreFocus();
      setClosing(true);
    },
    [restoreFocus],
  );

  /** dialog 가 닫힌 뒤(네이티브 close 또는 이미 닫혀 있던 경우) 상태를 정리하고 Presence 제거를 알린다 */
  const settle = useCallback(() => {
    closingRef.current = false;
    reasonRef.current = null;
    exitStartedRef.current = false;
    setClosing(false);
    if (!isPresentRef.current) safeToRemoveRef.current?.();
  }, []);

  // 퇴장 애니메이션 완료 → 실제 닫기. skipAnimations 에서도 완료 콜백이 (다음 프레임에) 돌아 즉시 닫힌다
  const finishClose = useCallback(() => {
    if (!closingRef.current) return;
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close(); // → 네이티브 close 이벤트 → handleNativeClose
    } else {
      settle(); // 애니메이션 중 브라우저가 먼저 닫은 경우(취소 불가 cancel 등)
    }
  }, [settle]);

  // 안전장치: closing 이 커밋됐는데 m.div 가 'exit' 애니메이션을 시작하지 않았다면(LazyMotion 바깥이라 feature 가
  // 없는 경우 — 단위 테스트가 컴포넌트를 단독 렌더할 때) 완료 콜백이 영영 오지 않으므로 바로 닫는다.
  // m.div 의 onAnimationStart 는 자식 effect 에서 동기 호출되어 이 부모 effect 보다 먼저 실행된다.
  useEffect(() => {
    if (closing && !exitStartedRef.current) finishClose();
  }, [closing, finishClose]);

  useEffect(() => {
    openRef.current = open;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      notifiedRef.current = false;
      exitStartedRef.current = false;
      pressedInsideRef.current = false;
      dialog.showModal();
    }
    // 부모가 닫는 퇴장 도중 다시 열리면 퇴장을 취소하고 열린 상태로 되돌린다 — onClose 는 부르지 않는다
    // (Motion 도입 스펙 §9.1 Q2). 취소하지 않으면 퇴장 완료 시 close() 되어 open=true 인데 보이지 않는다
    if (open && dialog.open && closingRef.current && reasonRef.current === 'parent') {
      closingRef.current = false;
      reasonRef.current = null;
      exitStartedRef.current = false;
      setClosing(false);
    }
    if (!open && dialog.open) beginClose('parent');
  }, [open, beginClose]);

  useEffect(() => {
    if (isPresent) return;
    const dialog = dialogRef.current;
    if (dialog?.open) beginClose('presence');
    else safeToRemove?.();
  }, [isPresent, safeToRemove, beginClose]);

  // Esc: 네이티브 즉시 닫힘을 막고 퇴장부터 재생한다
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    beginClose('user');
  };

  // 부모가 open=false 로 닫았거나(openRef=false) Presence 언마운트로 닫힌 경우에는 다시 알리지 않는다
  const handleNativeClose = () => {
    const reason = reasonRef.current;
    settle();
    if (openRef.current && reason !== 'presence' && !notifiedRef.current) {
      notifiedRef.current = true;
      onClose();
    }
    restoreFocus();
  };

  // 닫혀 가는 동안(사용자 닫기 closing, 또는 부모 open=false) 은 항상 'exit'. open=false 렌더에서 'initial' 로 바뀌면
  // 같은 값의 애니메이션이 먼저 시작돼 'exit' 시작 콜백이 오지 않았다 (QA #35 CRITICAL)
  const panelState = open && !closing ? VARIANT_KEYS.animate : VARIANT_KEYS.exit;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-closing={closing ? '' : undefined}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      // 백드롭 클릭 판정 (modal-backdrop-press-origin 스펙 §2). 브라우저는 click 을 pointerdown·pointerup 대상의 공통 조상으로
      // 보내므로, 패널 안에서 눌러 백드롭에서 놓으면(헤더 드래그·텍스트 선택·DataTable 리사이즈) click 대상이 <dialog> 자신이 된다.
      // 그래서 누름이 패널 안에서 시작된 click 은 백드롭 클릭으로 보지 않는다(제외 방식).
      // - 캡처 단계로 기록한다: DataTable 리사이즈 핸들은 pointerdown 에서 stopPropagation 하므로 버블 단계에는 오지 않는다.
      // - pointerdown 기록이 없는 click(합성 click·보조기술)은 기존대로 백드롭 클릭이다.
      // - portal 로 top-layer 위에 띄운 요소는 <dialog> 의 자손이 아니라 기록되지 않는다(현재 createPortal 사용 0건).
      onPointerDownCapture={(event) => {
        pressedInsideRef.current = event.target !== event.currentTarget;
      }}
      onClick={(event) => {
        const pressedInside = pressedInsideRef.current;
        pressedInsideRef.current = false;
        if (event.target === event.currentTarget && !pressedInside) beginClose('user');
      }}
      className={cn(
        'm-auto w-[min(520px,calc(100vw-32px))] border-0 bg-transparent p-0 text-ink-900',
        // 백드롭 fade — duration·ease 는 tokens.ts 의 enter(240ms)/exit(160ms) 와 동일 값
        'backdrop:bg-ink-900/40 backdrop:transition-opacity backdrop:duration-240 backdrop:ease-[cubic-bezier(0.05,0.7,0.1,1)]',
        'starting:backdrop:opacity-0',
        'data-[closing]:backdrop:opacity-0 data-[closing]:backdrop:duration-160 data-[closing]:backdrop:ease-[cubic-bezier(0.3,0,0.8,0.15)]',
        className,
      )}
    >
      <m.div
        variants={scaleIn}
        initial={VARIANT_KEYS.initial}
        animate={panelState}
        onAnimationStart={(definition) => {
          if (definition === VARIANT_KEYS.exit) exitStartedRef.current = true;
        }}
        onAnimationComplete={(definition) => {
          if (definition === VARIANT_KEYS.exit) finishClose();
        }}
        className={cn(
          'rounded-2xl bg-surface-card shadow-(--shadow-elevated)',
          closing && 'pointer-events-none',
        )}
      >
        <div className="flex items-center justify-between gap-4 px-6 pt-6">
          <h2 id={titleId} className="m-0 [font:var(--text-h2)]">
            {title}
          </h2>
          <CloseButton onClick={() => beginClose('user')} />
        </div>
        <div className="px-6 py-5 text-[14px] text-text-secondary">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border-subtle px-6 py-4">
            {footer}
          </div>
        ) : null}
      </m.div>
    </dialog>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="닫기"
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-pill border-0 bg-gray-75 text-[16px] leading-none text-text-secondary shadow-(--hairline-subtle) hover:text-ink-900',
        PRESS_CLASSES,
      )}
    >
      ×
    </button>
  );
}
