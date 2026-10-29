'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';
import { navigateView } from '@/lib/page-state/view-navigation';
import {
  adminItemsHref,
  nextAdminItemSort,
  type AdminItemSortId,
  type AdminItemsFilter,
} from '@/lib/procurement/admin-items-filter';
import type { ActionResult } from '@/lib/result';
import type { ItemMutationResult } from '@/server/procurement/item-mutations';

import {
  addItemAction,
  editItemsAction,
  excludeItemsAction,
  includeReviewItemsAction,
  restoreItemsAction,
} from './actions';
import { ItemConfirmModal, type ConfirmRequest } from './ItemConfirmModal';
import { ItemEditModal, type ItemEditValues } from './ItemEditModal';
import { RegisteredItemsCard, type BulkPatch } from './RegisteredItemsCard';
import { ReviewQueueCard } from './ReviewQueueCard';
import { toTarget, type AdminItemRow, type ItemsAdminData, type ItemTrashRow } from './types';

type Notice = { tone: 'success' | 'warning' | 'error'; text: string };

const NOTICE_TONE: Record<Notice['tone'], string> = {
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700 shadow-(--hairline-default)',
  error: 'bg-surface-danger text-text-danger',
};

const describe = (rows: readonly AdminItemRow[]) =>
  rows.length === 1 ? `${rows[0]!.itemId} (${rows[0]!.product})` : `${rows.length}건`;

export type ItemsAdminPanelProps = {
  /** URL 에서 파싱한 조회 조건 (ItemsAdminSection) */
  filter: AdminItemsFilter;
  /** 서버에서 불러온 화면 데이터 */
  data: ItemsAdminData;
};

/**
 * 조달 관리 › 품목 관리 탭 (조달이 통합 UI-7) 클라이언트 패널. 일일 신규 품목 검토 + 등록 품목 관리 + 휴지통.
 * 데이터는 서버 섹션(ItemsAdminSection)이 URL 로 불러온다 — 검색·제품 필터는 1페이지로 router.replace, 페이지·정렬은 router.push
 * (navigateView — 조회 상태 기억과 같은 경로). 쓰기는 서버 액션 → router.refresh().
 * 동시 편집으로 "이미 처리됨"(CONFLICT + alreadyProcessed)이 오면 안내하고 새로고침한다.
 */
export function ItemsAdminPanel({ filter, data }: ItemsAdminPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [writing, setWriting] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [editing, setEditing] = useState<AdminItemRow | null>(null);
  const busy = writing || isPending;

  const refresh = () => startTransition(() => router.refresh());

  const go = (next: Partial<AdminItemsFilter>, mode: 'replace' | 'push') =>
    navigateView(adminItemsHref({ ...filter, ...next }), (href) =>
      startTransition(() =>
        mode === 'replace'
          ? router.replace(href, { scroll: false })
          : router.push(href, { scroll: false }),
      ),
    );

  /** 쓰기 실행 → 성공·"이미 처리됨"이면 안내 후 새로고침하고 null, 그 밖의 오류는 문구를 돌려준다 */
  const mutate = async (
    call: () => Promise<ActionResult<ItemMutationResult>>,
    success: (outcome: ItemMutationResult) => string,
    onDone?: () => void,
  ): Promise<string | null> => {
    setWriting(true);
    try {
      const result = await call();
      if (result.ok) {
        setNotice({ tone: 'success', text: success(result.data) });
        onDone?.();
        refresh();
        return null;
      }
      if (result.error.code === 'CONFLICT' && result.error.details?.alreadyProcessed) {
        setNotice({ tone: 'warning', text: result.error.message });
        onDone?.();
        refresh();
        return null;
      }
      return result.error.message;
    } finally {
      setWriting(false);
    }
  };

  /** 모달 없이 바로 실행 — 오류는 화면 위 안내로 */
  const runNow = async (perform: () => Promise<string | null>) => {
    const message = await perform();
    if (message) setNotice({ tone: 'error', text: message });
  };

  const include = (rows: AdminItemRow[], { all }: { all: boolean }, onDone: () => void) => {
    const undecided = rows.filter((row) => row.product === '기타');
    const ready = rows.filter((row) => row.product !== '기타');
    const undecidedNote = undecided.length
      ? `제품이 정해지지 않은 ${undecided.length}건은 제품을 먼저 골라야 추가할 수 있어요. 해당 줄의 제품명 칸에서 WAPPLES / D.AMO / iSIGN 중 하나를 선택해 주세요.`
      : null;
    if (ready.length === 0) {
      if (undecidedNote) setNotice({ tone: 'error', text: undecidedNote });
      return;
    }
    const perform = () =>
      mutate(
        () => includeReviewItemsAction({ targets: ready.map(toTarget) }),
        (outcome) =>
          `${outcome.count}건을 등록 품목에 추가했습니다.${undecided.length ? ` 제품 미정 ${undecided.length}건은 남겨 두었습니다.` : ''}`,
        onDone,
      );
    if (!all) {
      if (undecidedNote) setNotice({ tone: 'warning', text: undecidedNote });
      void runNow(perform);
      return;
    }
    setConfirm({
      title: '일괄 추가',
      confirmLabel: `${ready.length}건 추가`,
      body: (
        <>
          <p className="m-0">
            일일 신규 품목 <strong className="text-text-primary">{ready.length}건</strong>을 모두
            등록 품목에 추가할까요?
          </p>
          {undecidedNote ? (
            <p className="m-0 text-[12px] text-warning-700">{undecidedNote}</p>
          ) : null}
        </>
      ),
      perform,
    });
  };

  const exclude = (rows: AdminItemRow[], onDone?: () => void) => {
    if (rows.length === 0) return;
    setConfirm({
      title: '휴지통으로 옮기기',
      confirmLabel: '삭제',
      danger: true,
      body: (
        <p className="m-0">
          <strong className="text-text-primary">{describe(rows)}</strong>을 휴지통으로 옮길까요?
          휴지통에서 언제든 되살릴 수 있어요.
        </p>
      ),
      perform: () =>
        mutate(
          () => excludeItemsAction({ targets: rows.map(toTarget) }),
          (outcome) => `${outcome.count}건을 휴지통으로 옮겼습니다.`,
          onDone,
        ),
    });
  };

  const bulkEdit = (rows: AdminItemRow[], patch: BulkPatch, onDone: () => void) => {
    const parts = [
      patch.product ? `제품명 → ${patch.product}` : null,
      patch.detailCategory ? `세부분류 → ${patch.detailCategory}` : null,
    ].filter(Boolean);
    if (rows.length === 0 || parts.length === 0) return;
    setConfirm({
      title: '일괄 변경',
      confirmLabel: '적용',
      body: (
        <p className="m-0">
          선택한 <strong className="text-text-primary">{rows.length}건</strong>의 {parts.join(', ')}
          (으)로 바꿀까요?
        </p>
      ),
      perform: () =>
        mutate(
          () => editItemsAction({ targets: rows.map(toTarget), patch }),
          (outcome) => `${outcome.count}건을 바꿨습니다.`,
          onDone,
        ),
    });
  };

  const inlineEdit = (
    row: AdminItemRow,
    patch: { product?: string; detailCategory?: string | null },
  ) =>
    void runNow(() =>
      mutate(
        () => editItemsAction({ targets: [toTarget(row)], patch }),
        () =>
          `${row.itemId} 의 ${patch.product !== undefined ? '제품명을' : '세부분류를'} 바꿨습니다.`,
      ),
    );

  const saveEdit = (row: AdminItemRow, values: ItemEditValues) =>
    mutate(
      () =>
        editItemsAction({
          targets: [toTarget(row)],
          patch: {
            product: values.product,
            detailCategory: values.detailCategory,
            manufacturer: values.manufacturer,
            itemId: values.itemId,
            itemName: values.itemName,
          },
        }),
      (outcome) =>
        outcome.count ? `${values.itemId.trim()} 품목을 수정했습니다.` : '바뀐 내용이 없습니다.',
    );

  const restore = (row: ItemTrashRow) =>
    void runNow(() =>
      mutate(
        () => restoreItemsAction({ targets: [toTarget(row)] }),
        () => `${row.itemId} (${row.product})을 되살렸습니다.`,
      ),
    );

  return (
    <div className="flex flex-col gap-5">
      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-[14px]',
            NOTICE_TONE[notice.tone],
          )}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            aria-label="안내 닫기"
            onClick={() => setNotice(null)}
            className="flex shrink-0 border-0 bg-transparent p-0 text-current"
          >
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      <ReviewQueueCard
        rows={data.queue.rows}
        total={data.queue.total}
        detailOptions={data.detailOptions}
        busy={busy}
        onInclude={include}
        onExclude={exclude}
        onEdit={inlineEdit}
      />
      <RegisteredItemsCard
        registered={data.registered}
        trash={data.trash}
        detailOptions={data.detailOptions}
        filter={filter}
        busy={busy}
        onFilter={({ q, product }) => go({ q, product, page: 1 }, 'replace')}
        onSort={(id: AdminItemSortId) =>
          go({ sort: nextAdminItemSort(filter.sort, id), page: 1 }, 'push')
        }
        onPage={(page) => go({ page }, 'push')}
        onTrashPage={(trashPage) => go({ trashPage }, 'push')}
        onAdd={(values) =>
          mutate(
            () => addItemAction(values),
            () => `${values.product} ${values.itemId.trim()} 를 등록 품목에 추가했습니다.`,
          )
        }
        onEdit={setEditing}
        onExclude={exclude}
        onBulkEdit={bulkEdit}
        onRestore={restore}
      />

      {confirm ? <ItemConfirmModal request={confirm} onClose={() => setConfirm(null)} /> : null}
      {editing ? (
        <ItemEditModal
          row={editing}
          detailOptions={data.detailOptions}
          onClose={() => setEditing(null)}
          onSave={(values) => saveEdit(editing, values)}
        />
      ) : null}
    </div>
  );
}
