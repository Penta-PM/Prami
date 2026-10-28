'use client';

import { useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button } from '@/components/ui';
import { ImportFileRow } from '@/features/admin-policies/ImportFileRow';
import {
  selectedBatchId,
  selectionBlocksApply,
  type BatchOption,
  type FileSelection,
} from '@/features/admin-policies/types';

import { applyPartImportAction } from './actions';

type PartsExcelPanelProps = {
  options: readonly BatchOption[];
  onApplied: (text: string) => void;
  /** 업로드 미리보기 표 열 설정 저장 키 (#32 스펙 §5) */
  userId: string;
};

type Stats = Extract<Awaited<ReturnType<typeof applyPartImportAction>>, { ok: true }>['data'];

/**
 * 엑셀 등록 (§4.5.6, AC-32): 2컬럼(모델품번, 파츠품번) 업로드 → 미리보기(존재하지 않는 품번은 오류 목록)
 * → 적용(모델별 전체 교체). PR-3 ImportFileRow 재사용.
 */
export function PartsExcelPanel({ options, onApplied, userId }: PartsExcelPanelProps) {
  const [selection, setSelection] = useState<FileSelection>({
    mode: 'new',
    upload: null,
    reuseId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isPending, startTransition] = useTransition();
  const blocked = selectionBlocksApply(selection, false);

  const apply = () =>
    startTransition(async () => {
      const batchId = selectedBatchId(selection);
      if (!batchId) return;
      const result = await applyPartImportAction({ batchId, reused: selection.mode === 'reuse' });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setError(null);
      setStats(result.data);
      onApplied(
        `엑셀 매핑을 적용했습니다: 모델 ${result.data.models}개, 매핑 ${result.data.mappings}건`,
      );
    });

  return (
    <section
      aria-label="엑셀 등록"
      className="mb-7 flex flex-col gap-3 rounded-xl bg-surface-card p-6 shadow-(--hairline-default)"
    >
      <h2 className="m-0 text-[14px] font-semibold text-text-tertiary">
        엑셀 업로드 (모델-파츠 매핑)
      </h2>
      <p className="m-0 text-[12px] text-text-tertiary">
        `모델품번`, `파츠품번` 두 컬럼으로 구성된 엑셀 파일을 업로드하세요(모델명·파츠명 컬럼은
        참고용). 같은 모델에 여러 파츠가 있으면 행을 반복합니다. 존재하지 않는 품번은 오류 목록에
        표시되며 적용할 수 없습니다.
      </p>
      <ImportFileRow
        kind="parts"
        label="파츠 파일"
        uploadLabel="파츠 엑셀 업로드"
        options={options}
        selection={selection}
        onChange={setSelection}
        userId={userId}
      />
      <div className="flex items-center justify-end gap-2.5">
        {blocked ? (
          <span className="text-[12px] text-text-tertiary">
            오류 없는 파츠 파일을 선택하면 적용할 수 있습니다
          </span>
        ) : null}
        <Button variant="primary" disabled={blocked || isPending} onClick={apply}>
          {isPending ? '적용 중…' : '매핑 적용'}
        </Button>
      </div>
      <Presence>
        {error ? (
          <Collapse key="error" role="alert">
            <p className="m-0 rounded-lg bg-surface-danger px-3.5 py-3 text-[14px] text-text-danger">
              {error}
            </p>
          </Collapse>
        ) : null}
        {stats ? (
          <Collapse key="stats" role="status" aria-label="매핑 적용 완료">
            <p className="m-0 text-[12px] font-semibold text-success-700">
              적용 완료 — 모델 {stats.models}개 · 매핑 {stats.mappings}건 · 덮어쓴 모델{' '}
              {stats.replacedModels}개
            </p>
          </Collapse>
        ) : null}
      </Presence>
    </section>
  );
}
