'use client';

import { useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Checkbox, Input, Modal, Select } from '@/components/ui';

import { createPricePolicyAction, lookupItemAction, updatePricePolicyAction } from './actions';
import { formToInput, type PolicyFormValues } from './policy-form';

export type PolicyFormMode =
  { kind: 'create' } | { kind: 'edit'; id: number; source: 'erp' | 'manual' };

type PolicyFormModalProps = {
  mode: PolicyFormMode;
  initial: PolicyFormValues;
  /** 초기 품번의 품목상태 (수정·복사 시) */
  initialItemStatus: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
};

type SetField = <K extends keyof PolicyFormValues>(key: K, value: PolicyFormValues[K]) => void;

const CURRENCIES = ['KRW', 'USD', 'JPY'];

/** 폼 상태 + 품번 조회 + 저장 (봉투 오류는 필드 오류로 표시) */
function usePolicyForm(props: PolicyFormModalProps) {
  const [values, setValues] = useState(props.initial);
  const [itemStatus, setItemStatus] = useState(props.initialItemStatus);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set: SetField = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  const lookup = () =>
    startTransition(async () => {
      if (!values.itemCode.trim()) return;
      const result = await lookupItemAction(values.itemCode);
      if (!result.ok || !result.data) return setItemStatus(null);
      const item = result.data;
      setItemStatus(item.itemStatus);
      setValues((current) => ({
        ...current,
        itemName: current.itemName || item.itemName,
        productFamily: current.productFamily || (item.productFamily ?? ''),
        unit: current.unit || (item.unit ?? ''),
      }));
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const input = formToInput(values);
      const { mode } = props;
      const result =
        mode.kind === 'edit'
          ? await updatePricePolicyAction({ ...input, id: mode.id })
          : await createPricePolicyAction(input);
      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
        return;
      }
      const verb = mode.kind === 'edit' ? '수정' : '등록';
      props.onSaved(
        result.data.discarded
          ? `${verb}했습니다. 폐기 품목이라 상태는 미사용으로 저장되었습니다.`
          : `${verb}했습니다. 상태: ${result.data.operationStatus}`,
      );
    });
  };

  return { values, set, itemStatus, fieldErrors, error, isPending, lookup, submit };
}

/**
 * 가격정책 등록/수정 모달 (§4.5.3, R-10: 제목 "가격정책 등록"). 변경 사유 필수.
 * 폐기 품목이면 "운영중 불가 — 미사용으로 저장" 안내를 띄운다 (R-08, AC-23).
 */
export function PolicyFormModal(props: PolicyFormModalProps) {
  const { mode, onClose } = props;
  const form = usePolicyForm(props);
  return (
    <Modal
      open
      onClose={onClose}
      title={mode.kind === 'edit' ? '가격정책 수정' : '가격정책 등록'}
      className="w-[min(640px,calc(100vw-32px))]"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            variant="primary"
            type="submit"
            form="policy-form"
            disabled={form.isPending}
          >
            저장
          </Button>
        </>
      }
    >
      <form
        id="policy-form"
        onSubmit={form.submit}
        className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1"
      >
        <PolicyNotices mode={mode} itemStatus={form.itemStatus} error={form.error} />
        <PolicyFields
          values={form.values}
          errors={form.fieldErrors}
          set={form.set}
          onItemCodeBlur={form.lookup}
        />
      </form>
    </Modal>
  );
}

function PolicyNotices({
  mode,
  itemStatus,
  error,
}: {
  mode: PolicyFormMode;
  itemStatus: string | null;
  error: string | null;
}) {
  return (
    <>
      {itemStatus === '폐기' ? (
        <p
          role="note"
          className="m-0 rounded-lg bg-red-500/10 px-3 py-2.5 text-[12px] text-red-600"
        >
          폐기 품목입니다. 폐기 품목은 운영중 상태를 가질 수 없어 저장해도 상태는{' '}
          <strong>미사용</strong>입니다.
        </p>
      ) : null}
      {mode.kind === 'edit' && mode.source === 'erp' ? (
        <p className="m-0 rounded-lg bg-amber-500/15 px-3 py-2.5 text-[12px] text-amber-700">
          ERP 임포트 행을 수정하면 수동 등록 행으로 바뀌며, 다음 가격정책 적용 시 같은
          계열·적용시작일의 ERP 값으로 대체될 수 있습니다.
        </p>
      ) : null}
      <Presence>
        {error ? (
          <Collapse key="error" role="alert">
            <p className="m-0 rounded-lg bg-red-500/10 px-3 py-2.5 text-[13px] text-red-600">
              {error}
            </p>
          </Collapse>
        ) : null}
      </Presence>
    </>
  );
}

type TextField = {
  key: keyof PolicyFormValues;
  label: string;
  wide?: boolean;
  props?: Record<string, string>;
};

/** 모달 텍스트 필드 (디자인 필드 + 원본 20컬럼 편집 항목). `*` 필수 */
const TEXT_FIELDS: readonly TextField[] = [
  { key: 'productFamily', label: '제품군 *' },
  { key: 'itemCode', label: '품번 *', props: { placeholder: '예: P10100015' } },
  { key: 'itemName', label: '품명 *', wide: true },
  { key: 'priceType', label: '단가유형' },
  { key: 'priceCategory', label: '단가구분 *' },
  { key: 'unitPrice', label: '단가 *', props: { inputMode: 'decimal' } },
  { key: 'effectiveFrom', label: '적용시작일 *', props: { type: 'date' } },
  { key: 'unit', label: '단위 *' },
  { key: 'baseCoreCount', label: '기준코어수', props: { inputMode: 'numeric' } },
  { key: 'unitPricePerCore', label: '단가(1코어)', props: { inputMode: 'decimal' } },
  { key: 'customerCode', label: '거래처코드' },
  { key: 'customerNo', label: '고객 번호' },
  { key: 'customerName', label: '고객명' },
  { key: 'spec', label: '규격' },
];

const CHECKBOXES: readonly { key: 'hasCorePrice' | 'appliesToAllCustomers'; label: string }[] = [
  { key: 'hasCorePrice', label: '코어단가유무' },
  { key: 'appliesToAllCustomers', label: '전체고객적용여부' },
];

type FieldsProps = {
  values: PolicyFormValues;
  errors: Record<string, string[]>;
  set: SetField;
  onItemCodeBlur: () => void;
};

function PolicyFields({ values, errors, set, onItemCodeBlur }: FieldsProps) {
  const text = ({ key, label, props }: TextField) => (
    <Field label={label} error={errors[key]}>
      <Input
        name={key}
        value={String(values[key])}
        onChange={(event) => set(key, event.target.value as never)}
        onBlur={key === 'itemCode' ? onItemCodeBlur : undefined}
        {...props}
      />
    </Field>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {TEXT_FIELDS.map((field) => (
        <div key={field.key} className={field.wide ? 'col-span-2' : undefined}>
          {text(field)}
        </div>
      ))}
      <Field label="화폐 *" error={errors.currency}>
        <Select
          name="currency"
          value={values.currency}
          onChange={(event) => set('currency', event.target.value)}
        >
          {CURRENCIES.map((currency) => (
            <option key={currency}>{currency}</option>
          ))}
        </Select>
      </Field>
      <div className="col-span-2 flex items-center gap-4 text-[12px] text-text-secondary">
        {CHECKBOXES.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-1.5">
            <Checkbox checked={values[key]} onChange={(event) => set(key, event.target.checked)} />
            {label}
          </label>
        ))}
      </div>
      <div className="col-span-2">{text({ key: 'remark', label: '비고' })}</div>
      <div className="col-span-2">
        {text({
          key: 'reason',
          label: '변경 사유 * (감사 로그에 기록됩니다)',
          props: { placeholder: '예: 2027년 정가 정책 반영' },
        })}
      </div>
    </div>
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
      {error?.length ? <span className="text-[12px] text-red-600">{error.join(' ')}</span> : null}
    </label>
  );
}
