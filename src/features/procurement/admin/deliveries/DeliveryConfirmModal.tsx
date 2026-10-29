'use client';

import { useState, useTransition, type ReactNode } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Modal } from '@/components/ui';
import type { ActionResult } from '@/lib/result';

export type DeliveryConfirmModalProps<T> = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  variant?: 'primary' | 'danger';
  /** 확인 — 서버 액션 호출. 결과는 onDone 으로 넘기고, onDone 이 false 를 돌려주면 모달에 오류를 남긴다 */
  action: () => Promise<ActionResult<T>>;
  /** 결과 처리. true = 처리 끝(부모가 모달을 닫는다), false = 이 모달에 오류 표시 */
  onDone: (result: ActionResult<T>) => boolean;
  onClose: () => void;
};

/**
 * 실적 관리 확인 모달 (조달이 통합 UI-6 — `window.confirm`·`alert` 대신 Prami 모달). 휴지통 이동·되살리기·편집 저장에 쓴다.
 * 확인 중에는 버튼을 막아 중복 요청을 보내지 않는다.
 */
export function DeliveryConfirmModal<T>({
  title,
  children,
  confirmLabel,
  variant = 'primary',
  action,
  onDone,
  onClose,
}: DeliveryConfirmModalProps<T>) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      const result = await action();
      const handled = onDone(result);
      if (!handled) setError(result.ok ? null : result.error.message);
    });

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant={variant} disabled={isPending} onClick={confirm}>
            {isPending ? '처리 중…' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      <Presence>
        {error ? (
          <Collapse key="error" role="alert">
            <p className="m-0 mt-3 text-[12px] text-text-danger">{error}</p>
          </Collapse>
        ) : null}
      </Presence>
    </Modal>
  );
}
