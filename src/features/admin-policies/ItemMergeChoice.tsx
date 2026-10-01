'use client';

import { Button, Modal, Segmented } from '@/components/ui';

export type ItemMergeMode = 'merge' | 'replace';

export type ItemMergeInfo = { missingFamilies: string[]; vanishingItems: number };

const MODE_OPTIONS = [
  { value: 'merge', label: '누락 제품군 유지 (병합)' },
  { value: 'replace', label: '전량 교체' },
] as const;

/**
 * 품목 배치에 직전 적용 품목의 제품군이 빠졌을 때 병합 방식 선택 (PRAMI-003 §4.2.3, Q-10).
 * 선택 전에는 적용 버튼이 비활성이다(ImportPanel). 한 제품군 파일만 새로 받아도 나머지를 다시 올릴 필요가 없다.
 */
export function ItemMergeChoice({
  info,
  value,
  onChange,
}: {
  info: ItemMergeInfo;
  value: ItemMergeMode | null;
  onChange: (mode: ItemMergeMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="품목 제품군 병합 방식"
      className="flex flex-col gap-2 rounded-lg bg-amber-500/10 px-3.5 py-2.5 text-[12px]"
    >
      <p className="m-0">
        이번 품목 배치에 직전 적용 품목의 제품군 <strong>{info.missingFamilies.join(', ')}</strong>{' '}
        이(가) 없습니다. 병합 방식을 선택하세요.
      </p>
      <Segmented
        aria-label="병합 방식"
        options={MODE_OPTIONS}
        value={(value ?? '') as ItemMergeMode}
        onChange={(mode: ItemMergeMode) => onChange(mode)}
      />
      {value === 'replace' ? (
        <p className="m-0 text-red-500">
          전량 교체하면 {info.vanishingItems.toLocaleString('ko-KR')}개 품번이 품목 마스터에서
          빠지고 그 판매단가 행은 미확인(stub)이 됩니다.
        </p>
      ) : null}
    </div>
  );
}

/** 전량 교체 확인 모달 — 사라질 품번 수를 보여 준다 */
export function ReplaceConfirmModal({
  open,
  vanishingItems,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  vanishingItems: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="품목 전량 교체"
      footer={
        <>
          <Button size="sm" onClick={onCancel}>
            취소
          </Button>
          <Button size="sm" variant="primary" onClick={onConfirm}>
            전량 교체 적용
          </Button>
        </>
      }
    >
      <p className="m-0 text-[13px]">
        이번 배치에 없는 제품군의 품번 {vanishingItems.toLocaleString('ko-KR')}개가 사라집니다.
        계속할까요?
      </p>
    </Modal>
  );
}
