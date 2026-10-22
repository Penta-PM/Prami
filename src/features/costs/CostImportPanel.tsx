'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import { DuplicateWarningLists } from '@/features/admin-policies/DuplicateWarningLists';
import { ErpDataGuide } from '@/features/admin-policies/ErpDataGuide';
import { ImportFileRow } from '@/features/admin-policies/ImportFileRow';
import {
  selectedBatchId,
  selectionBlocksApply,
  type BatchOption,
  type FileSelection,
} from '@/features/admin-policies/types';
import { ERP_HINT_COSTS } from '@/lib/constants/erp-guide';

import { applyCostImportAction } from './actions';

type CostImportPanelProps = {
  /** 현재 사용자 id — 업로드 미리보기 표의 열 설정 저장 키 (#32) */
  userId: string;
  options: readonly BatchOption[];
  currentBatchId: string | null;
};

type ApplyResult = Extract<Awaited<ReturnType<typeof applyCostImportAction>>, { ok: true }>['data'];
type Stats = ApplyResult['stats'];

const STAT_LABELS: readonly [keyof Stats, string][] = [
  ['inserted', 'ERP 적재 행'],
  ['materialCount', '자재 수'],
  ['seriesCount', '계열 수'],
  ['latestCount', '계열 최신 행(운영중)'],
  ['otherFamilyRows', '제품군 기타'],
  ['sameDateDuplicateGroups', '같은 날짜 중복'],
  ['manualPreserved', '수동 등록 보존'],
  ['manualConflicts', '수동 등록 → ERP 우선 대체'],
];

/**
 * 원가 파일 적용 (§4.4.7, R-11 과 같은 신규 업로드/기존 파일 재사용 모델). PR-3 ImportFileRow 재사용.
 * 디자인의 "업로드 적용 연도"는 판매단가와 같은 이유(연도 파일 개념 제거, R-05)로 두지 않는다.
 */
export function CostImportPanel({ userId, options, currentBatchId }: CostImportPanelProps) {
  const router = useRouter();
  const [selection, setSelection] = useState<FileSelection>(
    currentBatchId
      ? { mode: 'reuse', upload: null, reuseId: currentBatchId }
      : { mode: 'new', upload: null, reuseId: '' },
  );
  const [outcome, setOutcome] = useState<
    { ok: true; result: ApplyResult } | { ok: false; message: string } | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const blocked = selectionBlocksApply(selection, false);

  const apply = () =>
    startTransition(async () => {
      const batchId = selectedBatchId(selection);
      if (!batchId) return;
      const result = await applyCostImportAction({ batchId, reused: selection.mode === 'reuse' });
      setOutcome(
        result.ok
          ? { ok: true, result: result.data }
          : { ok: false, message: result.error.message },
      );
      if (result.ok) router.refresh();
    });

  return (
    <section aria-label="원가 파일 적용" className="flex flex-col gap-2.5">
      <ErpDataGuide />
      <ImportFileRow
        userId={userId}
        kind="costs"
        label="원가 파일"
        uploadLabel="구매단가 엑셀 업로드"
        options={options}
        selection={selection}
        onChange={setSelection}
        erpHint={ERP_HINT_COSTS}
        note={
          <span className="text-[11px] text-text-tertiary">
            구매단가등록 12컬럼 · 제품군은 자재번호 접두(W1/W2/W4)로 분류
          </span>
        }
      />
      <div className="flex items-center justify-end gap-2.5">
        {blocked ? (
          <span className="text-[12px] text-text-tertiary">
            오류 없는 원가 파일을 선택하면 적용할 수 있습니다
          </span>
        ) : null}
        <Button variant="primary" size="sm" disabled={blocked || isPending} onClick={apply}>
          {isPending ? '적용 중…' : '원가 적용'}
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
          <Collapse key="applied" className="flex flex-col gap-2.5">
            <CostApplyStats stats={outcome.result.stats} />
            <DuplicateWarningLists
              warnings={outcome.result.warnings}
              stage="applied"
              headerRowIndex={outcome.result.headerRowIndex}
            />
          </Collapse>
        ) : null}
      </Presence>
    </section>
  );
}

function CostApplyStats({ stats }: { stats: Stats }) {
  return (
    <div
      role="status"
      aria-label="원가 적용 완료"
      className="rounded-lg bg-surface-card p-3.5 shadow-(--hairline-default)"
    >
      <p className="m-0 mb-2 text-[12px] font-semibold text-green-700">원가 적용 완료</p>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-4">
        {STAT_LABELS.map(([key, label]) => (
          <div key={String(key)} className="flex justify-between gap-3">
            <dt className="text-text-tertiary">{label}</dt>
            <dd className="m-0 font-semibold tabular-nums">{stats[key].toLocaleString('ko-KR')}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
