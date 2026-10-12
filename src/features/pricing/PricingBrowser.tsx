'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import { DataTableResetButton, type DataTableSort } from '@/components/ui/data-table';
import { parseSortParams } from '@/lib/table/sort-param';

import { getPriceRowDetailAction } from './actions';
import { layoutColumnsFor, PRICE_TABLE_IDS, type TableMode } from './columns';
import { DeletePolicyModal } from './DeletePolicyModal';
import { filterToQuery, PRICE_SORT_IDS, type PriceFilter } from './filter';
import { EMPTY_POLICY_FORM, formFromRow, type PolicyFormValues } from './policy-form';
import { PolicyFormModal, type PolicyFormMode } from './PolicyFormModal';
import { PriceTable } from './PriceTable';
import { RowDetailDrawer } from './RowDetailDrawer';
import type { PriceRowView } from './types';

/** 표 헤더의 정렬 → URL 정렬. 화이트리스트 파서를 그대로 거쳐 허용된 id 만 남긴다 (#32 스펙 §3) */
function urlSort<Id extends string>(next: DataTableSort, allowed: readonly Id[]) {
  return parseSortParams(next ? { sort: next.id, dir: next.dir } : {}, allowed);
}

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

  // 관리 칸 렌더러를 안정적으로 유지해 표 열 배열이 렌더마다 바뀌지 않게 한다
  const openFromRow = useCallback(
    (row: PriceRowView, kind: 'edit' | 'copy') =>
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
      }),
    [],
  );

  const done = (text: string) => {
    setForm(null);
    setDeleting(null);
    setFlash({ tone: 'ok', text });
    router.refresh();
  };

  return { form, setForm, deleting, setDeleting, flash, openCreate, openFromRow, done };
}

/** 등록·수정·삭제 결과 배너 — `Presence` 안에서 `Collapse` 로 펼쳐지고 접힌다 (Motion 도입 스펙 §3.3 인라인 피드백) */
function FlashMessage({ flash }: { flash: Flash }) {
  const error = flash.tone === 'error';
  return (
    <Collapse role={error ? 'alert' : 'status'}>
      <p
        className={
          error
            ? 'm-0 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-500'
            : 'm-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-700'
        }
      >
        {flash.text}
      </p>
    </Collapse>
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

type PricingBrowserProps = {
  mode: TableMode;
  rows: readonly PriceRowView[];
  /** 현재 URL 필터 — 정렬을 바꾸면 이 필터 그대로 sort/dir 만 바꾸고 1페이지로 간다 (#32 스펙 §3) */
  filter: PriceFilter;
  /** 열 너비·순서 저장 키 (#32 스펙 §5) */
  userId: string;
};

/**
 * 표 + 행 상세 드로어 (조회), 관리 모드에서는 `+ 등록`·수정·복사·삭제까지 (§4.5.3).
 * 툴바의 '열 초기화'는 필터와 별개로 열 너비·순서만 되돌린다 (#32 스펙 §5).
 */
export function PricingBrowser({ mode, rows, filter, userId }: PricingBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [detailId, setDetailId] = useState<number | null>(null);
  const editing = usePolicyEditing();
  const { openFromRow, setDeleting } = editing;
  const admin = mode === 'admin';

  const changeSort = (next: DataTableSort) =>
    startTransition(() =>
      router.push(
        `${pathname}${filterToQuery({ ...filter, sort: urlSort(next, PRICE_SORT_IDS), page: 1 })}`,
      ),
    );

  const renderActions = useCallback(
    (row: PriceRowView) => (
      <RowActions
        row={row}
        onEdit={() => openFromRow(row, 'edit')}
        onCopy={() => openFromRow(row, 'copy')}
        onDelete={() => setDeleting(row)}
      />
    ),
    [openFromRow, setDeleting],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <DataTableResetButton
          tableId={PRICE_TABLE_IDS[mode]}
          userId={userId}
          columns={layoutColumnsFor(mode)}
        />
        {admin ? (
          <Button variant="primary" size="sm" onClick={editing.openCreate}>
            + 등록
          </Button>
        ) : null}
      </div>
      <Presence>
        {editing.flash ? <FlashMessage key="flash" flash={editing.flash} /> : null}
      </Presence>
      <PriceTable
        mode={mode}
        rows={rows}
        userId={userId}
        sort={filter.sort ?? null}
        onSortChange={changeSort}
        onRowClick={(row) => setDetailId(row.id)}
        renderActions={admin ? renderActions : undefined}
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
