'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { Button, Input, Select } from '@/components/ui';
import { PROCUREMENT_PRODUCTS, type ProcurementProduct } from '@/lib/procurement/constants';

const EMPTY = {
  product: PROCUREMENT_PRODUCTS[0] as ProcurementProduct,
  itemId: '',
  itemName: '',
  manufacturer: '',
};

export type ItemAddValues = typeof EMPTY;

/**
 * 직접 추가 (원본 "+ 직접 추가" 폼): 제품명* · 물품식별번호* · 품목명 · 제조사. 등록일자는 오늘, source = manual.
 * onSubmit 이 오류 문구를 돌려주면 폼 아래에 보여 주고 입력은 그대로 둔다.
 */
export function ItemAddForm({
  onSubmit,
}: {
  onSubmit: (values: ItemAddValues) => Promise<string | null>;
}) {
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = (patch: Partial<ItemAddValues>) =>
    setValues((previous) => ({ ...previous, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!values.itemId.trim()) {
      setError('물품식별번호를 입력하세요.');
      return;
    }
    startTransition(async () => {
      const message = await onSubmit(values);
      setError(message);
      if (!message) setValues({ ...EMPTY, product: values.product });
    });
  };

  return (
    <form
      aria-label="품목 직접 추가"
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-border-subtle bg-surface-muted px-5 py-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-[140px] flex-col gap-1 text-[12px] text-text-tertiary">
          제품명 *
          <Select
            value={values.product}
            onChange={(event) => set({ product: event.target.value as ProcurementProduct })}
          >
            {PROCUREMENT_PRODUCTS.map((product) => (
              <option key={product} value={product}>
                {product}
              </option>
            ))}
          </Select>
        </label>
        {(
          [
            ['itemId', '물품식별번호 *', '예: 00000000'],
            ['itemName', '품목명', '예: 웹방화벽'],
            ['manufacturer', '제조사', '예: 제조사명'],
          ] as const
        ).map(([field, label, placeholder]) => (
          <label
            key={field}
            className="flex min-w-[160px] flex-1 flex-col gap-1 text-[12px] text-text-tertiary"
          >
            {label}
            <Input
              value={values[field]}
              placeholder={placeholder}
              onChange={(event) => set({ [field]: event.target.value })}
            />
          </label>
        ))}
        <Button type="submit" variant="primary" disabled={isPending}>
          추가
        </Button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-[12px] text-text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
