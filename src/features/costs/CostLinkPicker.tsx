'use client';

import { useId, useMemo, useState } from 'react';

import { Input, Select } from '@/components/ui';
import type { CostLinkMaterial, CostLinkNoSuggestion } from '@/server/cost/item-link-types';

/**
 * 원가 자재 선택(검색 + 목록) — 원가 매핑 화면(#53 직접 선택)과 가격정책 관리 매핑 수정 모달(policy-cost-link-column §2.3-3)이 함께 쓴다.
 * 선택값은 호출 측 상태(초기값 = 현재 매핑 → 없으면 제안). 원가 금액은 없다(자재명·자재번호만).
 */

/** 제안이 없을 때의 이유 문구 */
export const NO_SUGGESTION_TEXT: Record<CostLinkNoSuggestion, string> = {
  'sw-upgrade': 'S/W 업그레이드 — 제안 없음',
  'no-model': '모델을 읽을 수 없음',
  'no-cost': '같은 모델 원가 없음',
  ambiguous: '같은 모델 원가가 여럿 — 직접 선택',
};

export function materialLabel(code: string, name: string | null): string {
  return name === null ? `${code} (원가표에 없음)` : `${name} (${code})`;
}

export type CostLinkPickerProps = {
  materials: readonly CostLinkMaterial[];
  /** 선택한 자재번호('' = 없음) */
  chosen: string;
  onChosenChange: (materialCode: string) => void;
  disabled?: boolean;
};

export function CostLinkPicker({
  materials,
  chosen,
  onChosenChange,
  disabled = false,
}: CostLinkPickerProps) {
  const [search, setSearch] = useState('');
  const searchId = useId();
  const selectId = useId();

  // 검색으로 걸러도 지금 선택한 자재는 목록에 남긴다
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return materials;
    return materials.filter(
      (material) =>
        material.materialName.toLowerCase().includes(needle) ||
        material.materialCode.toLowerCase().includes(needle) ||
        material.materialCode === chosen,
    );
  }, [materials, search, chosen]);

  return (
    <>
      <label htmlFor={searchId} className="text-[12px] font-medium text-text-secondary">
        자재명·자재번호 검색
      </label>
      <Input
        id={searchId}
        type="search"
        value={search}
        disabled={disabled}
        onChange={(event) => setSearch(event.target.value)}
      />
      <label htmlFor={selectId} className="text-[12px] font-medium text-text-secondary">
        원가 자재 ({filtered.length}건)
      </label>
      <Select
        id={selectId}
        size={8}
        value={chosen}
        disabled={disabled}
        onChange={(event) => onChosenChange(event.target.value)}
        className="pr-3.5"
      >
        {filtered.map((material) => (
          <option key={material.materialCode} value={material.materialCode}>
            {materialLabel(material.materialCode, material.materialName)}
          </option>
        ))}
      </Select>
    </>
  );
}
