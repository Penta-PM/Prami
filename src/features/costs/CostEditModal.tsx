'use client';

import { useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Input, Modal } from '@/components/ui';

import { upsertMaterialCostAction } from './actions';
import type { CostRowView } from './types';

type CostEditModalProps = {
  row: CostRowView;
  onClose: () => void;
  onSaved: (message: string) => void;
};

/** 원가 수정 (§4.5.5): 원가·적용시작일·비고, 변경 사유 필수 → 감사 material_cost.update */
export function CostEditModal({ row, onClose, onSaved }: CostEditModalProps) {
  const [values, setValues] = useState({
    unitCost: String(Number(row.unitCost)),
    effectiveFrom: row.effectiveFrom,
    remark: row.remark ?? '',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await upsertMaterialCostAction({ id: row.id, ...values });
      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
        return;
      }
      onSaved(`수정했습니다. 상태: ${result.data.operationStatus}`);
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="원가 수정"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            variant="primary"
            type="submit"
            form="cost-edit-form"
            disabled={isPending}
          >
            저장
          </Button>
        </>
      }
    >
      <form id="cost-edit-form" onSubmit={submit} className="flex flex-col gap-3">
        <p className="m-0 text-[13px]">
          <strong className="text-ink-900">{row.materialName}</strong> ({row.materialCode}) ·{' '}
          {row.unit}
        </p>
        {row.source === 'erp' ? (
          <p className="m-0 rounded-lg bg-amber-500/15 px-3 py-2.5 text-[12px] text-amber-700">
            ERP 임포트 행을 수정하면 수동 등록 행으로 바뀌며, 다음 원가 적용 시 같은
            자재·적용시작일의 ERP 값으로 대체될 수 있습니다.
          </p>
        ) : null}
        <Presence>
          {error ? (
            <Collapse key="error" role="alert">
              <p className="m-0 rounded-lg bg-red-500/10 px-3 py-2.5 text-[13px] text-red-500">
                {error}
              </p>
            </Collapse>
          ) : null}
        </Presence>
        <CostEditFields row={row} values={values} fieldErrors={fieldErrors} onChange={set} />
      </form>
    </Modal>
  );
}

type EditValues = { unitCost: string; effectiveFrom: string; remark: string; reason: string };

type CostEditFieldsProps = {
  row: CostRowView;
  values: EditValues;
  fieldErrors: Record<string, string[]>;
  onChange: (key: keyof EditValues, value: string) => void;
};

function CostEditFields({ row, values, fieldErrors, onChange }: CostEditFieldsProps) {
  const set = onChange;
  return (
    <>
      <Field label={`원가 (${row.currency}) *`} error={fieldErrors.unitCost}>
        <Input
          name="unitCost"
          inputMode="decimal"
          value={values.unitCost}
          onChange={(e) => set('unitCost', e.target.value)}
        />
      </Field>
      <Field label="적용시작일 *" error={fieldErrors.effectiveFrom}>
        <Input
          name="effectiveFrom"
          type="date"
          value={values.effectiveFrom}
          onChange={(e) => set('effectiveFrom', e.target.value)}
        />
      </Field>
      <Field label="비고" error={fieldErrors.remark}>
        <Input
          name="remark"
          value={values.remark}
          onChange={(e) => set('remark', e.target.value)}
        />
      </Field>
      <Field label="변경 사유 * (감사 로그에 기록됩니다)" error={fieldErrors.reason}>
        <Input
          name="reason"
          value={values.reason}
          onChange={(e) => set('reason', e.target.value)}
          placeholder="예: 2026년 구매 계약 단가 반영"
        />
      </Field>
    </>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string[];
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      {children}
      {error?.length ? <span className="text-[12px] text-red-500">{error.join(' ')}</span> : null}
    </label>
  );
}
