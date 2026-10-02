'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';

import { getPriceRowDetailAction } from './actions';
import type { TableMode } from './columns';
import { DeletePolicyModal } from './DeletePolicyModal';
import { EMPTY_POLICY_FORM, formFromRow, type PolicyFormValues } from './policy-form';
import { PolicyFormModal, type PolicyFormMode } from './PolicyFormModal';
import { PriceTable } from './PriceTable';
import { RowDetailDrawer } from './RowDetailDrawer';
import type { PriceRowView } from './types';

type FormState = { mode: PolicyFormMode; initial: PolicyFormValues; itemStatus: string | null };
type Flash = { tone: 'ok' | 'error'; text: string };

const ACTION_BUTTON =
  'border-0 bg-transparent px-1.5 py-1 text-[12px] font-semibold hover:underline';

/** 등록·수정·복사·삭제 상태 — 수정·복사는 행 상세(원본 20컬럼)를 불러와 폼을 채운다 */
function usePolicyEditing() {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<PriceRowView | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [, startTransition] = useTransition();

  const openCreate = () =>
    setForm({ mode: { kind: 'create' }, initial: EMPTY_POLICY_FORM, itemStatus: null });

  const openFromRow = (row: PriceRowView, kind: 'edit' | 'copy') =>
    startTransition(async () => {
      const result = await getPriceRowDetailAction(row.id);
      if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
      const detail = result.data.row;
      const initial = formFromRow(detail);
      setForm({
        mode:
          kind === 'edit'
            ? { kind: 'edit', id: row.id, source: detail.source }
            : { kind: 'create' },
        // 복사 = 기존 값으로 채운 "가격정책 등록" (적용시작일만 새로 입력, Q-09)
        initial: kind === 'copy' ? { ...initial, effectiveFrom: '' } : initial,
        itemStatus: detail.itemStatus,
      });
    });

  const done = (text: string) => {
    setForm(null);
    setDeleting(null);
    setFlash({ tone: 'ok', text });
    router.refresh();
  };

  return { form, setForm, deleting, setDeleting, flash, openCreate, openFromRow, done };
}

function FlashMessage({ flash }: { flash: Flash }) {
  const error = flash.tone === 'error';
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={
        error
          ? 'm-0 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-500'
          : 'm-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-700'
      }
    >
      {flash.text}
    </p>
  );
}

type RowActionsProps = {
  row: PriceRowView;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

function RowActions({ row, onEdit, onCopy, onDelete }: RowActionsProps) {
  const buttons = [
    { label: '수정', tone: 'text-purple-600', onClick: onEdit },
    { label: '복사', tone: 'text-text-tertiary', onClick: onCopy },
    { label: '삭제', tone: 'text-red-500', onClick: onDelete },
  ];
  return (
    <>
      {buttons.map(({ label, tone, onClick }) => (
        <button
          key={label}
          type="button"
          aria-label={`${row.itemName} ${label}`}
          className={`${ACTION_BUTTON} ${tone}`}
          onClick={onClick}
        >
          {label}
        </button>
      ))}
    </>
  );
}

/**
 * 표 + 행 상세 드로어 (조회), 관리 모드에서는 `+ 등록`·수정·복사·삭제까지 (§4.5.3).
 */
export function PricingBrowser({ mode, rows }: { mode: TableMode; rows: readonly PriceRowView[] }) {
  const [detailId, setDetailId] = useState<number | null>(null);
  const editing = usePolicyEditing();
  const admin = mode === 'admin';

  return (
    <div className="flex flex-col gap-3">
      {admin ? (
        <div className="flex items-center justify-end">
          <Button variant="primary" size="sm" onClick={editing.openCreate}>
            + 등록
          </Button>
        </div>
      ) : null}
      {editing.flash ? <FlashMessage flash={editing.flash} /> : null}
      <PriceTable
        mode={mode}
        rows={rows}
        onRowClick={(row) => setDetailId(row.id)}
        renderActions={
          admin
            ? (row) => (
                <RowActions
                  row={row}
                  onEdit={() => editing.openFromRow(row, 'edit')}
                  onCopy={() => editing.openFromRow(row, 'copy')}
                  onDelete={() => editing.setDeleting(row)}
                />
              )
            : undefined
        }
      />
      <RowDetailDrawer rowId={detailId} onClose={() => setDetailId(null)} />
      <Presence>
        {editing.form ? (
          <PolicyFormModal
            key={JSON.stringify(editing.form.mode)}
            mode={editing.form.mode}
            initial={editing.form.initial}
            initialItemStatus={editing.form.itemStatus}
            onClose={() => editing.setForm(null)}
            onSaved={editing.done}
          />
        ) : null}
      </Presence>
      <Presence>
        {editing.deleting ? (
          <DeletePolicyModal
            row={editing.deleting}
            onClose={() => editing.setDeleting(null)}
            onDeleted={editing.done}
          />
        ) : null}
      </Presence>
    </div>
  );
}
