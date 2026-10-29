'use client';

import { m, useIsPresent, type Variants } from 'motion/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { Presence } from '@/components/motion/Presence';
import { cn } from '@/lib/cn';
import { fade, transition, VARIANT_KEYS } from '@/lib/motion/tokens';

import { densityAttrs } from './density';
import { CloseButton } from './modal';

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 패널 너비(px). 기본 480 */
  width?: number;
  className?: string;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * 드로어 패널 — 오른쪽에서 x 100%→0 + fade (Motion 도입 스펙 §3.3 드로어 표: 24px 프리셋이 아니라 패널 폭 전체).
 * duration·ease 는 토큰 transition.enter / transition.exit
 */
const drawerPanel: Variants = {
  initial: { opacity: 0, x: '100%' },
  animate: { opacity: 1, x: 0, transition: transition.enter },
  exit: { opacity: 0, x: '100%', transition: transition.exit },
};

/**
 * 열릴 때 패널 안 첫 요소로 포커스를 옮기고, 퇴장이 시작되는 시점(isPresent=false)에 이전 포커스를 복원한다.
 * Presence 바깥에서 통째로 언마운트되는 경우에는 cleanup 에서 복원한다
 */
function useRestoreFocus(isPresent: boolean, panelRef: RefObject<HTMLElement | null>) {
  const previousRef = useRef<HTMLElement | null>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    previousRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) (getFocusable(panel)[0] ?? panel).focus();
    return () => {
      if (!restoredRef.current) previousRef.current?.focus();
    };
  }, [panelRef]);

  // 퇴장 시작 커밋(inert 가 붙는 커밋)과 같은 프레임에 포커스를 옮기도록 layout effect 로 둔다
  useLayoutEffect(() => {
    if (isPresent || restoredRef.current) return;
    restoredRef.current = true;
    const previous = previousRef.current;
    if (previous && previous !== document.body && previous.isConnected) {
      previous.focus();
      return;
    }
    // 돌려줄 트리거가 없으면(포커스를 받지 않는 표 행 클릭으로 연 경우 — 열기 전 포커스가 body) 퇴장 중 inert 패널에
    // 포커스가 남지 않도록 놓아 준다 (Motion 도입 스펙 §3.3 드로어 "퇴장 시작 시 복원·퇴장 중 inert")
    const panel = panelRef.current;
    if (
      panel &&
      document.activeElement instanceof HTMLElement &&
      panel.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }
  }, [isPresent, panelRef]);
}

/** Tab 을 패널 안에서 순환시킨다 */
function trapTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const focusable = getFocusable(event.currentTarget);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** 오른쪽에서 열리는 드로어. 행 상세(RowDetailDrawer) 등에 사용한다. open=false 가 되면 퇴장을 재생한 뒤 제거된다 */
export function Drawer({ open, ...panelProps }: DrawerProps) {
  return <Presence>{open ? <DrawerPanel key="drawer" {...panelProps} /> : null}</Presence>;
}

function DrawerPanel({
  onClose,
  title,
  children,
  width = 480,
  className,
}: Omit<DrawerProps, 'open'>) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  // <Presence> 가 언마운트를 알리면(퇴장 시작) 포커스를 돌려주고 패널을 inert 로 만든다
  const isPresent = useIsPresent();
  useRestoreFocus(isPresent, panelRef);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    trapTab(event);
  };

  return (
    <div className={cn('fixed inset-0 z-50 flex justify-end', !isPresent && 'pointer-events-none')}>
      <m.div
        data-testid="drawer-overlay"
        aria-hidden="true"
        onClick={onClose}
        variants={fade}
        initial={VARIANT_KEYS.initial}
        animate={VARIANT_KEYS.animate}
        exit={VARIANT_KEYS.exit}
        className="absolute inset-0 bg-neutral-900/40"
      />
      <m.aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // 드로어는 밀집 컨테이너 — 안의 공용 컨트롤 기본 sm(36·14) (Q-D1 = B)
        {...densityAttrs('sm')}
        tabIndex={-1}
        inert={!isPresent || undefined}
        onKeyDown={handleKeyDown}
        variants={drawerPanel}
        initial={VARIANT_KEYS.initial}
        animate={VARIANT_KEYS.animate}
        exit={VARIANT_KEYS.exit}
        style={{ width }}
        className={cn(
          // Penta 사이드패널 그림자 xl
          'relative flex h-full max-w-full flex-col bg-surface-card shadow-panel outline-none',
          className,
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border-subtle px-6 py-5">
          <h2 id={titleId} className="m-0 [font:var(--text-h2)]">
            {title}
          </h2>
          <CloseButton onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5 text-[14px] text-text-secondary">
          {children}
        </div>
      </m.aside>
    </div>
  );
}
