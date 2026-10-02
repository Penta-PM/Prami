'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Input, Modal } from '@/components/ui';
import { priceLabel } from '@/lib/pricing/format';
import { periodLabel } from '@/lib/pricing/period';

import { deletePricePolicyAction } from './actions';
import type { PriceRowView } from './types';

type DeletePolicyModalProps = {
  row: PriceRowView;
  onClose: () => void;
  onDeleted: (message: string) => void;
};

/** 가격정책 삭제 (soft delete, 사유 필수, 계열 재계산 — §4.5.3) */
export function DeletePolicyModal({ row, onClose, onDeleted }: DeletePolicyModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await deletePricePolicyAction({ id: row.id, reason });
      if (!result.ok) {
        setError(result.error.fieldErrors?.reason?.join(' ') ?? result.error.message);
        return;
      }
      onDeleted('삭제했습니다. 같은 계열의 최신 행과 운영상태를 다시 계산했습니다.');
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="가격정책 삭제"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            variant="danger"
            type="submit"
            form="policy-delete-form"
            disabled={isPending}
          >
            삭제
          </Button>
        </>
      }
    >
      <form id="policy-delete-form" onSubmit={submit} className="flex flex-col gap-3">
        <p className="m-0">
          <strong className="text-ink-900">{row.itemName}</strong> ({row.itemCode}) ·{' '}
          {priceLabel(row.unitPrice, row.currency)} ·{' '}
          {periodLabel(row.effectiveFrom, row.effectiveTo)}
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-secondary">
            변경 사유 * (감사 로그에 기록됩니다)
          </span>
          <Input name="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <Presence>
          {error ? (
            <Collapse key="error" role="alert">
              <p className="m-0 text-[12px] text-red-500">{error}</p>
            </Collapse>
          ) : null}
        </Presence>
      </form>
    </Modal>
  );
}
