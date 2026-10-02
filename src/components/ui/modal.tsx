'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

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
 * 네이티브 <dialog> 기반 모달. Esc·배경 클릭·닫기 버튼 모두 dialog.close() 로 모이고,
 * 네이티브 close 이벤트 한 곳에서만 onClose 를 호출한다 (사용자 행동 1회 = onClose 1회).
 */
export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  const titleId = useId();

  useEffect(() => {
    openRef.current = open;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const requestClose = () => dialogRef.current?.close();

  // 부모가 open=false 로 닫은 경우(openRef=false)에는 다시 알리지 않는다
  const handleNativeClose = () => {
    if (openRef.current) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleNativeClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      className={cn(
        'm-auto w-[min(520px,calc(100vw-32px))] rounded-2xl border-0 bg-surface-card p-0 text-ink-900 shadow-(--shadow-elevated)',
        'backdrop:bg-ink-900/40',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4 px-6 pt-6">
        <h2 id={titleId} className="m-0 [font:var(--text-h2)]">
          {title}
        </h2>
        <CloseButton onClick={requestClose} />
      </div>
      <div className="px-6 py-5 text-[14px] text-text-secondary">{children}</div>
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-border-subtle px-6 py-4">
          {footer}
        </div>
      ) : null}
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
