'use client';

import { useState, useTransition } from 'react';

import { Button, Modal } from '@/components/ui';
import type { ActionResult } from '@/lib/result';
import type { MailRecipientView } from '@/server/procurement/mail-recipients';

import { removeMailRecipientAction } from './actions';

type MailRecipientRemoveModalProps = {
  recipient: MailRecipientView;
  /** 남는 수신처 수 (이 주소를 지운 뒤) — 0 이면 보고 메일이 멈춘다고 알린다 */
  remaining: number;
  onClose: () => void;
  /** 삭제됨 또는 이미 처리됨(CONFLICT) — 패널이 안내하고 새로 불러온다. 그 밖의 오류는 모달 안에 보여 준다 */
  onDone: (result: ActionResult<MailRecipientView>) => void;
};

/** 수신처 삭제 확인 (Prami 확인 모달 — confirm 금지). 삭제와 감사 procurement.mail_recipient.remove 는 같은 트랜잭션 */
export function MailRecipientRemoveModal({
  recipient,
  remaining,
  onClose,
  onDone,
}: MailRecipientRemoveModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      const result = await removeMailRecipientAction({ id: recipient.id });
      if (result.ok || result.error.code === 'CONFLICT') {
        onDone(result);
        return;
      }
      setError(result.error.message);
    });

  return (
    <Modal
      open
      onClose={onClose}
      title="수신처 삭제"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="danger" disabled={isPending} onClick={remove}>
            삭제
          </Button>
        </>
      }
    >
      <p className="m-0 break-keep">
        <strong className="break-all text-text-primary">{recipient.email}</strong> 수신처를
        삭제할까요? 다음 보고부터 이 주소로는 메일을 보내지 않습니다.{' '}
        {remaining === 0 ? '남는 수신처가 없어 보고 메일이 멈춥니다. ' : ''}삭제는 감사 로그에
        남습니다.
      </p>
      {error ? (
        <p role="alert" className="m-0 mt-3 text-[12px] text-text-danger">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
