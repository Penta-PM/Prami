'use client';

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { cn } from '@/lib/cn';

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

/** 열릴 때 패널 안 첫 요소로 포커스를 옮기고, 닫힐 때 이전 포커스를 복원한다 */
function useRestoreFocus(open: boolean, panelRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) (getFocusable(panel)[0] ?? panel).focus();
    return () => previous?.focus();
  }, [open, panelRef]);
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

/** 오른쪽에서 열리는 드로어. 행 상세(RowDetailDrawer) 등에 사용한다 */
export function Drawer({ open, onClose, title, children, width = 480, className }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  useRestoreFocus(open, panelRef);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    trapTab(event);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        data-testid="drawer-overlay"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{ width }}
        className={cn(
          'relative flex h-full max-w-full flex-col bg-surface-card shadow-(--shadow-elevated) outline-none',
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
      </aside>
    </div>
  );
}
