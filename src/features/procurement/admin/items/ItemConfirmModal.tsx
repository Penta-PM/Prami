'use client';

import { useState, useTransition, type ReactNode } from 'react';

import { Button, Modal } from '@/components/ui';

export type ConfirmRequest = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** 실행. 오류 문구를 돌려주면 모달에 남겨 보여 주고, null 이면 닫는다 */
  perform: () => Promise<string | null>;
};

/** 품목 관리 확인 모달 (window.confirm 대신 — 단계 3 공통) */
export function ItemConfirmModal({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      const message = await request.perform();
      if (message) setError(message);
      else onClose();
    });

  return (
    <Modal
      open
      onClose={onClose}
      title={request.title}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant={request.danger ? 'danger' : 'primary'}
            disabled={isPending}
            onClick={confirm}
          >
            {request.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {request.body}
        {error ? (
          <p role="alert" className="m-0 text-[12px] text-text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
