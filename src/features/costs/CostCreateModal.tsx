'use client';

import { useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Input, Modal } from '@/components/ui';

import { upsertMaterialCostAction } from './actions';

type CostCreateModalProps = {
  onClose: () => void;
  onSaved: (message: string) => void;
};

type CreateValues = {
  materialCode: string;
  materialName: string;
  spec: string;
  unit: string;
  priceType: string;
  priceCategory: string;
  currency: string;
  unitCost: string;
  effectiveFrom: string;
  remark: string;
  reason: string;
};

const EMPTY: CreateValues = {
  materialCode: '',
  materialName: '',
  spec: '',
  unit: 'EA',
  priceType: '표준구매원가',
  priceCategory: '일반',
  currency: 'KRW',
  unitCost: '',
  effectiveFrom: '',
  remark: '',
  reason: '',
};

const FIELDS: readonly { key: keyof CreateValues; label: string; type?: string }[] = [
  { key: 'materialCode', label: '자재번호 *' },
  { key: 'materialName', label: '자재명 *' },
  { key: 'spec', label: '규격' },
  { key: 'unit', label: '단위 *' },
  { key: 'priceType', label: '단가유형 *' },
  { key: 'priceCategory', label: '단가구분 *' },
  { key: 'currency', label: '화폐 *' },
  { key: 'unitCost', label: '원가 *' },
  { key: 'effectiveFrom', label: '적용시작일 *', type: 'date' },
  { key: 'remark', label: '비고' },
  { key: 'reason', label: '변경 사유 * (감사 로그에 기록됩니다)' },
];

/** 원가 수동 등록 (§4.4.7 r4 4): 같은 계열·적용시작일이 있으면(ERP 행 포함) 적용시작일 필드 오류 → 감사 material_cost.create */
export function CostCreateModal({ onClose, onSaved }: CostCreateModalProps) {
  const [values, setValues] = useState<CreateValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();
  const set = (key: keyof CreateValues, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await upsertMaterialCostAction(values);
      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
        return;
      }
      onSaved(`등록했습니다. 상태: ${result.data.operationStatus}`);
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="원가 등록"
      className="w-[min(560px,calc(100vw-32px))]"
      footer={<Footer onClose={onClose} isPending={isPending} />}
    >
      <form
        id="cost-create-form"
        onSubmit={submit}
        className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1"
      >
        <Presence>
          {error ? (
            <Collapse key="error" role="alert">
              <p className="m-0 rounded-lg bg-red-500/10 px-3 py-2.5 text-[13px] text-red-500">
                {error}
              </p>
            </Collapse>
          ) : null}
        </Presence>
        {FIELDS.map((field) => (
          <Field key={field.key} label={field.label} error={fieldErrors[field.key]}>
            <Input
              name={field.key}
              type={field.type ?? 'text'}
              inputMode={field.key === 'unitCost' ? 'decimal' : undefined}
              value={values[field.key]}
              onChange={(e) => set(field.key, e.target.value)}
            />
          </Field>
        ))}
      </form>
    </Modal>
  );
}

function Footer({ onClose, isPending }: { onClose: () => void; isPending: boolean }) {
  return (
    <>
      <Button size="sm" onClick={onClose}>
        취소
      </Button>
      <Button
        size="sm"
        variant="primary"
        type="submit"
        form="cost-create-form"
        disabled={isPending}
      >
        저장
      </Button>
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
