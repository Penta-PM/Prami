'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Button, Modal, Segmented } from '@/components/ui';
import type { BatchOption } from '@/features/admin-policies/types';

import { deletePartMappingAction, savePartMappingAction } from './actions';
import { PartsEditor } from './PartsEditor';
import { PartsExcelPanel } from './PartsExcelPanel';
import { PartsMappingTable } from './PartsMappingTable';
import type { CatalogItemView, PartMappingView, PartsMode } from './types';

type PartsManagerProps = {
  models: readonly CatalogItemView[];
  parts: readonly CatalogItemView[];
  mappings: readonly PartMappingView[];
  batchOptions: readonly BatchOption[];
  /** 매핑 표의 열 너비·순서 저장 키 (#32 스펙 §5) */
  userId: string;
};

const MODE_OPTIONS = [
  { value: 'manual', label: '수동 등록' },
  { value: 'excel', label: '엑셀 등록' },
] as const;

type Flash = { tone: 'ok' | 'error'; text: string };

/**
 * 파츠 관리 (§4.5.6, R-02): 수동 등록/엑셀 등록 토글, 모델별 전체 교체 저장(AC-30·31), 등록된 매핑 표.
 * 제품군 탭은 서버 컴포넌트(페이지)가 URL 로 다룬다.
 */
export function PartsManager({ models, parts, mappings, batchOptions, userId }: PartsManagerProps) {
  const router = useRouter();
  const [mode, setMode] = useState<PartsMode>('manual');
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<PartMappingView | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [isPending, startTransition] = useTransition();
  const mappedModels = new Set(mappings.map((mapping) => mapping.modelItemCode));

  const reset = () => {
    setSelectedModel(null);
    setChecked(new Set());
    setEditing(false);
  };

  const toggle = (itemCode: string, on: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      if (on) next.add(itemCode);
      else next.delete(itemCode);
      return next;
    });

  const save = () =>
    startTransition(async () => {
      if (!selectedModel) return;
      const result = await savePartMappingAction({
        modelItemCode: selectedModel,
        partItemCodes: [...checked],
      });
      if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
      setFlash({
        tone: 'ok',
        text: result.data.replaced
          ? `저장했습니다 — 기존 매핑을 새 선택 ${result.data.partItemCodes.length}건으로 교체했습니다`
          : `저장했습니다 — 파츠 ${result.data.partItemCodes.length}건`,
      });
      reset();
      router.refresh();
    });

  // 매핑 표의 열 배열(useMemo) 의존성이라 안정적인 참조로 둔다 — setter 만 쓴다
  const edit = useCallback((mapping: PartMappingView) => {
    setMode('manual');
    setSelectedModel(mapping.modelItemCode);
    setChecked(new Set(mapping.parts.map((part) => part.itemCode)));
    setEditing(true);
  }, []);

  const remove = () =>
    startTransition(async () => {
      if (!deleting) return;
      const result = await deletePartMappingAction({ modelItemCode: deleting.modelItemCode });
      setDeleting(null);
      if (!result.ok) return setFlash({ tone: 'error', text: result.error.message });
      setFlash({ tone: 'ok', text: `삭제했습니다: ${deleting.modelName}` });
      if (selectedModel === deleting.modelItemCode) reset();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-[18px]">
      <Segmented
        aria-label="등록 방식"
        options={MODE_OPTIONS}
        value={mode}
        onChange={(next: PartsMode) => setMode(next)}
        className="w-fit"
      />
      <Presence>
        {flash ? (
          <Collapse key="flash" role={flash.tone === 'error' ? 'alert' : 'status'}>
            <p
              className={
                flash.tone === 'error'
                  ? 'm-0 rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-600'
                  : 'm-0 rounded-lg bg-green-600/12 px-3.5 py-2.5 text-[13px] text-green-700'
              }
            >
              {flash.text}
            </p>
          </Collapse>
        ) : null}
      </Presence>
      {mode === 'manual' ? (
        <PartsEditor
          models={models}
          parts={parts}
          mappedModels={mappedModels}
          selectedModel={selectedModel}
          checked={checked}
          editing={editing}
          isPending={isPending}
          onSelectModel={(code) => {
            // 이미 매핑된 모델을 다시 고르면 기존 파츠를 체크 상태로 복원한다 (PR-6 QA INFO-3) — 저장은 여전히 전체 교체
            const existing = mappings.find((mapping) => mapping.modelItemCode === code);
            setSelectedModel(code);
            setChecked(new Set(existing?.parts.map((part) => part.itemCode) ?? []));
            setEditing(false);
          }}
          onToggle={toggle}
          onCancel={reset}
          onSave={save}
        />
      ) : (
        <PartsExcelPanel
          options={batchOptions}
          userId={userId}
          onApplied={(text) => {
            setFlash({ tone: 'ok', text });
            router.refresh();
          }}
        />
      )}
      <PartsMappingTable mappings={mappings} onEdit={edit} onDelete={setDeleting} userId={userId} />
      <Presence>
        {deleting ? (
          <Modal
            open
            onClose={() => setDeleting(null)}
            title="매핑 삭제"
            footer={
              <>
                <Button size="sm" onClick={() => setDeleting(null)}>
                  취소
                </Button>
                <Button size="sm" variant="danger" disabled={isPending} onClick={remove}>
                  삭제
                </Button>
              </>
            }
          >
            <p className="m-0">
              <strong className="text-ink-900">{deleting.modelName}</strong> 의 장착 가능 파츠{' '}
              {deleting.parts.length}건을 모두 삭제합니다.
            </p>
          </Modal>
        ) : null}
      </Presence>
    </div>
  );
}
