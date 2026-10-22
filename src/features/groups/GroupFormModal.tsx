'use client';

import { useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Checkbox, Input, Modal } from '@/components/ui';
import type { ActionResult } from '@/lib/result';
import { priceLabel } from '@/lib/pricing/format';

import { upsertSolutionGroupAction } from './actions';
import type { GroupCandidateView, SolutionGroupView } from './types';

export type GroupFormMode = { kind: 'create' } | { kind: 'edit'; group: SolutionGroupView };

type GroupFormModalProps = {
  mode: GroupFormMode;
  family: string;
  candidates: readonly GroupCandidateView[];
  onClose: () => void;
  onDone: (result: ActionResult<{ id: string; name: string }>) => void;
};

/**
 * 그룹 생성/수정 모달 (디자인 "솔루션 그룹 관리"): 그룹명 + 포함할 상세 제품(제품군의 운영중 정상판매 품목,
 * 최신 가격 표시). 가격은 저장하지 않는다 (§4.3.7).
 */
export function GroupFormModal({ mode, family, candidates, onClose, onDone }: GroupFormModalProps) {
  const editing = mode.kind === 'edit' ? mode.group : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    new Set(editing?.items.map((item) => item.itemCode) ?? []),
  );
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  const toggle = (itemCode: string, on: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(itemCode);
      else next.delete(itemCode);
      return next;
    });

  const submit = () =>
    startTransition(async () => {
      const result = await upsertSolutionGroupAction({
        ...(editing ? { id: editing.id } : {}),
        productFamily: family,
        name,
        items: [...checked].map((itemCode) => ({ itemCode, defaultQty: 1 })),
      });
      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
      }
      onDone(result);
    });

  const q = query.trim().toLowerCase();
  const visible = candidates.filter(
    (item) =>
      !q || item.itemName.toLowerCase().includes(q) || item.itemCode.toLowerCase().includes(q),
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? '그룹 수정' : '그룹 생성'}
      className="w-[min(560px,calc(100vw-32px))]"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" variant="primary" disabled={isPending} onClick={submit}>
            저장
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Presence>
          {error ? (
            <Collapse key="error" role="alert">
              <p className="m-0 rounded-lg bg-red-500/10 px-3 py-2.5 text-[13px] text-red-600">
                {error}
              </p>
            </Collapse>
          ) : null}
        </Presence>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-secondary">그룹명</span>
          <Input
            name="name"
            value={name}
            placeholder="예: iSIGN SSO Agent"
            onChange={(event) => setName(event.target.value)}
          />
          {fieldErrors.name?.length ? (
            <span className="text-[12px] text-red-600">{fieldErrors.name.join(' ')}</span>
          ) : null}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-secondary">
            포함할 상세 제품 ({family} · 운영중 정상판매 · 선택 {checked.size})
          </span>
          <Input
            type="search"
            aria-label="상세 제품 검색"
            value={query}
            placeholder="품명, 품번으로 검색"
            onChange={(event) => setQuery(event.target.value)}
          />
          {fieldErrors.items?.length ? (
            <span className="text-[12px] text-red-600">{fieldErrors.items.join(' ')}</span>
          ) : null}
          <div
            role="group"
            aria-label="상세 제품 목록"
            className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto"
          >
            {visible.map((item) => (
              <label
                key={item.itemCode}
                className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-[12px] font-medium shadow-(--hairline-subtle)"
              >
                <span className="flex items-center gap-2">
                  <Checkbox
                    checked={checked.has(item.itemCode)}
                    onChange={(event) => toggle(item.itemCode, event.target.checked)}
                  />
                  {item.itemName}
                  <span className="text-[11px] font-normal text-text-tertiary">
                    {item.itemCode}
                  </span>
                </span>
                <span className="text-[11px] font-semibold whitespace-nowrap text-text-tertiary">
                  {priceLabel(item.unitPrice, item.currency)}
                </span>
              </label>
            ))}
            {visible.length === 0 ? (
              <p className="m-0 text-[12px] text-text-tertiary">해당 조건의 품목이 없습니다.</p>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
