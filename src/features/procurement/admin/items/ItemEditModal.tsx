'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { Button, Input, Modal, Select } from '@/components/ui';
import { PROCUREMENT_PRODUCTS } from '@/lib/procurement/constants';

import { IsignCategorySelect } from './DetailCategoryField';
import type { AdminItemRow } from './types';

export type ItemEditValues = {
  product: string;
  detailCategory: string;
  manufacturer: string;
  itemId: string;
  itemName: string;
};

/**
 * 등록 품목 한 줄 수정 (원본 ITEM_EDIT_FIELDS: 제품명·세부분류·제조사명·물품식별번호·품목). iSIGN 세부분류는 목록에서 고른다.
 * onSave 가 오류 문구를 돌려주면 모달에 남긴다.
 */
export function ItemEditModal({
  row,
  detailOptions,
  onClose,
  onSave,
}: {
  row: AdminItemRow;
  detailOptions: Record<string, string[]>;
  onClose: () => void;
  onSave: (values: ItemEditValues) => Promise<string | null>;
}) {
  const [values, setValues] = useState<ItemEditValues>({
    product: row.product,
    detailCategory: row.detailCategory ?? '',
    manufacturer: row.manufacturer ?? '',
    itemId: row.itemId,
    itemName: row.itemName ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = (patch: Partial<ItemEditValues>) =>
    setValues((previous) => ({ ...previous, ...patch }));
  const products = PROCUREMENT_PRODUCTS.includes(row.product as never)
    ? PROCUREMENT_PRODUCTS
    : [...PROCUREMENT_PRODUCTS, row.product];

  const save = (event?: FormEvent) => {
    event?.preventDefault();
    if (!values.itemId.trim()) {
      setError('물품식별번호를 입력하세요.');
      return;
    }
    startTransition(async () => {
      const message = await onSave(values);
      if (message) setError(message);
      else onClose();
    });
  };

  const field = 'flex flex-col gap-1 text-[12px] text-text-tertiary';
  return (
    <Modal
      open
      onClose={onClose}
      title="품목 수정"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" variant="primary" disabled={isPending} onClick={() => save()}>
            저장
          </Button>
        </>
      }
    >
      <form aria-label="품목 수정" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          제품명
          <Select value={values.product} onChange={(event) => set({ product: event.target.value })}>
            {products.map((product) => (
              <option key={product} value={product}>
                {product}
              </option>
            ))}
          </Select>
        </label>
        <div className={field}>
          <span id="item-edit-detail">세부분류</span>
          {values.product === 'iSIGN' ? (
            <IsignCategorySelect
              label="세부분류"
              value={values.detailCategory}
              onChange={(detailCategory) => set({ detailCategory })}
              className="py-2.5"
            />
          ) : (
            <>
              <Input
                aria-labelledby="item-edit-detail"
                value={values.detailCategory}
                list="item-edit-detail-options"
                onChange={(event) => set({ detailCategory: event.target.value })}
              />
              <datalist id="item-edit-detail-options">
                {(detailOptions[values.product] ?? []).map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </>
          )}
        </div>
        <label className={field}>
          제조사명
          <Input
            value={values.manufacturer}
            onChange={(event) => set({ manufacturer: event.target.value })}
          />
        </label>
        <label className={field}>
          물품식별번호
          <Input value={values.itemId} onChange={(event) => set({ itemId: event.target.value })} />
        </label>
        <label className={`${field} sm:col-span-2`}>
          품목
          <Input
            value={values.itemName}
            onChange={(event) => set({ itemName: event.target.value })}
          />
        </label>
        {/* Enter 로 저장 */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      {error ? (
        <p role="alert" className="m-0 mt-3 text-[12px] text-red-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
