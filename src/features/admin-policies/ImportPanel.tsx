'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import type { PolicyApplyStats } from '@/db/schema';

import { applyPolicyAction, previewItemMergeAction } from './actions';
import { ApplyStatsView } from './ApplyStatsView';
import { ImportFileRow } from './ImportFileRow';
import {
  ItemMergeChoice,
  ReplaceConfirmModal,
  type ItemMergeInfo,
  type ItemMergeMode,
} from './ItemMergeChoice';
import {
  selectedBatchId,
  selectionBlocksApply,
  type BatchOption,
  type FileSelection,
} from './types';

type ImportPanelProps = {
  /** 현재 사용자 id — 업로드 미리보기 표의 열 설정 저장 키 (#32) */
  userId: string;
  salesOptions: readonly BatchOption[];
  itemOptions: readonly BatchOption[];
  /** 현재 적용 중인 배치 (기존 파일 재사용의 기본 선택) */
  currentSalesId: string | null;
  currentItemId: string | null;
};

type ApplyOutcome = { ok: true; stats: PolicyApplyStats } | { ok: false; message: string };

function blockedReason(previewPending: boolean, mergeUnchosen: boolean): string {
  if (mergeUnchosen) return '품목 제품군 병합 방식을 선택하면 적용할 수 있습니다';
  if (previewPending) return '품목 제품군 병합 여부를 확인하는 중입니다…';
  return '오류 없는 판매단가 파일을 선택하면 적용할 수 있습니다';
}

function initialSelection(currentId: string | null): FileSelection {
  return currentId
    ? { mode: 'reuse', upload: null, reuseId: currentId }
    : { mode: 'new', upload: null, reuseId: '' };
}

/**
 * 가격정책 관리 상단 임포트 패널 (§4.5.3 ①②③, R-05·R-11).
 * 판매단가/품목상태 파일을 각각 신규 업로드 또는 기존 파일 재사용으로 고른 뒤 "가격정책 적용".
 */
export function ImportPanel({
  userId,
  salesOptions,
  itemOptions,
  currentSalesId,
  currentItemId,
}: ImportPanelProps) {
  const router = useRouter();
  const [sales, setSales] = useState(() => initialSelection(currentSalesId));
  const [item, setItem] = useState(() => initialSelection(currentItemId));
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null);
  const [isPending, startTransition] = useTransition();
  const itemBatchId = selectedBatchId(item);
  // 미리보기·선택은 품목 배치 id 에 묶는다 — 배치를 바꾸면 이전 선택이 자동으로 무효 (PRAMI-003 §4.2.3)
  // info=null 은 미리보기 실패(서버가 적용 시 다시 판정한다)
  const [preview, setPreview] = useState<{ batchId: string; info: ItemMergeInfo | null } | null>(
    null,
  );
  const [choice, setChoice] = useState<{ batchId: string; mode: ItemMergeMode } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const mergeInfo = preview && preview.batchId === itemBatchId ? preview.info : null;
  // 품목 배치를 고른 뒤 병합 미리보기 응답 전에는 병합 선택 필요 여부를 모르므로 적용을 잠근다 (QA L-4)
  const previewPending = itemBatchId !== null && preview?.batchId !== itemBatchId;
  const itemMerge = choice && choice.batchId === itemBatchId ? choice.mode : null;
  const setItemMerge = (mode: ItemMergeMode) => {
    if (itemBatchId) setChoice({ batchId: itemBatchId, mode });
  };

  useEffect(() => {
    if (!itemBatchId) return;
    let active = true;
    void previewItemMergeAction(itemBatchId).then(
      (result) => {
        if (active) setPreview({ batchId: itemBatchId, info: result.ok ? result.data : null });
      },
      () => {
        if (active) setPreview({ batchId: itemBatchId, info: null });
      },
    );
    return () => {
      active = false;
    };
  }, [itemBatchId]);

  const needsMerge = (mergeInfo?.missingFamilies.length ?? 0) > 0;
  const blocked =
    selectionBlocksApply(sales, false) ||
    selectionBlocksApply(item, true) ||
    previewPending ||
    (needsMerge && itemMerge === null);

  const runApply = () =>
    startTransition(async () => {
      setConfirming(false);
      const salesBatchId = selectedBatchId(sales);
      if (!salesBatchId) return;
      const result = await applyPolicyAction({
        salesBatchId,
        itemBatchId,
        salesReused: sales.mode === 'reuse',
        itemReused: item.mode === 'reuse',
        ...(needsMerge && itemMerge ? { itemMerge } : {}),
      });
      setOutcome(
        result.ok
          ? { ok: true, stats: result.data.stats }
          : { ok: false, message: result.error.message },
      );
      if (result.ok) router.refresh();
    });

  const apply = () => (needsMerge && itemMerge === 'replace' ? setConfirming(true) : runApply());

  return (
    <section aria-label="가격정책 파일 적용" className="flex flex-col gap-2.5">
      <ImportFileRow
        userId={userId}
        kind="sales"
        label="판매단가 파일"
        uploadLabel="판매단가 엑셀 업로드"
        options={salesOptions}
        selection={sales}
        onChange={setSales}
      />
      <ImportFileRow
        userId={userId}
        kind="items"
        label="품목상태 파일"
        uploadLabel="품목조회 파일 업로드 (1~5개, 제품군별)"
        options={itemOptions}
        selection={item}
        onChange={setItem}
        optional
        multiple
        note={
          <span className="text-[11px] text-text-tertiary">
            폐기 품목은 운영중 상태를 가질 수 없습니다.
          </span>
        }
      />
      {needsMerge && mergeInfo ? (
        <ItemMergeChoice info={mergeInfo} value={itemMerge} onChange={setItemMerge} />
      ) : null}
      <ReplaceConfirmModal
        open={confirming}
        vanishingItems={mergeInfo?.vanishingItems ?? 0}
        {...(mergeInfo?.operating ? { operating: mergeInfo.operating } : {})}
        onCancel={() => setConfirming(false)}
        onConfirm={runApply}
      />
      <div className="flex items-center justify-end gap-2.5">
        {blocked ? (
          <span className="text-[12px] text-text-tertiary">
            {blockedReason(previewPending, needsMerge && itemMerge === null)}
          </span>
        ) : null}
        <Button variant="primary" size="sm" disabled={blocked || isPending} onClick={apply}>
          {isPending ? '적용 중…' : '가격정책 적용'}
        </Button>
      </div>
      <Presence>
        {outcome?.ok === false ? (
          <Collapse key="error" role="alert">
            <p className="m-0 rounded-lg bg-red-500/10 px-3.5 py-3 text-[13px] text-red-600">
              {outcome.message}
            </p>
          </Collapse>
        ) : null}
        {outcome?.ok ? (
          <Collapse key="applied">
            <ApplyStatsView title="적용 완료" stats={outcome.stats} />
          </Collapse>
        ) : null}
      </Presence>
    </section>
  );
}
