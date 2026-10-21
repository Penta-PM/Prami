'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Input, Modal } from '@/components/ui';
import { priceLabel } from '@/lib/pricing/format';
import { periodLabel } from '@/lib/pricing/period';

import { deleteMaterialCostAction } from './actions';
import type { CostRowView } from './types';

type CostDeleteModalProps = {
  row: CostRowView;
  onClose: () => void;
  onDeleted: (message: string) => void;
};

/** 원가 삭제 (soft delete, 사유 필수, 계열 재계산 → 감사 material_cost.delete) */
export function CostDeleteModal({ row, onClose, onDeleted }: CostDeleteModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await deleteMaterialCostAction({ id: row.id, reason });
      if (!result.ok) {
        setError(result.error.fieldErrors?.reason?.join(' ') ?? result.error.message);
        return;
      }
      onDeleted('삭제했습니다. 같은 자재 계열의 최신 행과 상태를 다시 계산했습니다.');
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="원가 삭제"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            variant="danger"
            type="submit"
            form="cost-delete-form"
            disabled={isPending}
          >
            삭제
          </Button>
        </>
      }
    >
      <form id="cost-delete-form" onSubmit={submit} className="flex flex-col gap-3">
        <p className="m-0">
          <strong className="text-ink-900">{row.materialName}</strong> ({row.materialCode}) ·{' '}
          {priceLabel(row.unitCost, row.currency)} ·{' '}
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
              <p className="m-0 text-[12px] text-red-600">{error}</p>
            </Collapse>
          ) : null}
        </Presence>
      </form>
    </Modal>
  );
}
