'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { CheckMark, Input } from '@/components/ui';
import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';
import type { CostLinkMaterial, CostLinkNoSuggestion } from '@/server/cost/item-link-types';

/**
 * 원가 자재 선택(검색 콤보박스 + 목록) — 원가 매핑 화면(#53 직접 선택)과 가격정책 관리 매핑 수정 모달(policy-cost-link-column §2.3-3)이 함께 쓴다.
 * 선택값은 호출 측 상태(초기값 = 현재 매핑 → 없으면 제안). 원가 금액은 없다(자재명·자재번호만).
 *
 * 디자인 보정 §7.4: 검색 `role="combobox"`(aria-controls·aria-activedescendant) + `role="listbox"`/`option`(aria-selected).
 * - 행: 1행 자재명(최대 2줄), 2행 자재번호(tabular-nums) + [현재]/[제안] 배지, 선택 행은 옅은 보라 + 오른쪽 체크.
 * - ↑↓ 로 활성 행 이동, Enter 로 선택 — Enter 는 모달 폼 제출로 이어지지 않는다(preventDefault). 클릭으로도 선택.
 * - 렌더 상한 COST_LINK_PICKER_RENDER_MAX 건 — 넘으면 "검색어를 좁혀 주세요". 지금 선택한 자재는 검색·상한과 무관하게 목록에 남긴다.
 */

/** 제안이 없을 때의 이유 문구 */
export const NO_SUGGESTION_TEXT: Record<CostLinkNoSuggestion, string> = {
  'sw-upgrade': 'S/W 업그레이드 — 제안 없음',
  'no-model': '모델을 읽을 수 없음',
  'no-cost': '같은 모델 원가 없음',
  ambiguous: '같은 모델 원가가 여럿 — 직접 선택',
};

/** 목록에 한 번에 그리는 최대 행 수 (현재 자재 157개 — 늘어나도 DOM 이 커지지 않게) */
export const COST_LINK_PICKER_RENDER_MAX = 200;

export function materialLabel(code: string, name: string | null): string {
  return name === null ? `${code} (원가표에 없음)` : `${name} (${code})`;
}

export type CostLinkPickerProps = {
  materials: readonly CostLinkMaterial[];
  /** 선택한 자재번호('' = 없음) */
  chosen: string;
  onChosenChange: (materialCode: string) => void;
  /** 지금 확정된 매핑의 자재번호 — [현재] 배지 */
  currentCode?: string | null;
  /** 제안 자재번호 — [제안] 배지 */
  suggestedCode?: string | null;
  disabled?: boolean;
};

const BADGE_CLASS =
  'inline-flex shrink-0 items-center rounded-pill px-1.5 py-px text-[11px] leading-[16px] font-semibold';

export function CostLinkPicker({
  materials,
  chosen,
  onChosenChange,
  currentCode = null,
  suggestedCode = null,
  disabled = false,
}: CostLinkPickerProps) {
  const [search, setSearch] = useState('');
  const baseId = useId();
  const searchId = `${baseId}-search`;
  const listId = `${baseId}-list`;
  const labelId = `${baseId}-label`;
  const optionId = (code: string) => `${baseId}-opt-${code}`;
  const listRef = useRef<HTMLDivElement>(null);

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

  const visible = useMemo(() => {
    if (filtered.length <= COST_LINK_PICKER_RENDER_MAX) return filtered;
    const head = filtered.slice(0, COST_LINK_PICKER_RENDER_MAX);
    if (chosen === '' || head.some((material) => material.materialCode === chosen)) return head;
    const picked = filtered.find((material) => material.materialCode === chosen);
    return picked ? [...head, picked] : head;
  }, [filtered, chosen]);
  const truncated = filtered.length > COST_LINK_PICKER_RENDER_MAX;
  // 검색어에 실제로 맞는 자재 수 — 검색과 무관하게 남긴 선택 자재는 세지 않는다(그것만 남으면 "검색 결과가 없습니다")
  const matchCount = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return filtered.length;
    return filtered.filter(
      (material) =>
        material.materialName.toLowerCase().includes(needle) ||
        material.materialCode.toLowerCase().includes(needle),
    ).length;
  }, [filtered, search]);

  // 활성 행(키보드 커서) — 자재번호로 들고, 목록에 없으면 선택한 행
  const [active, setActive] = useState<string | null>(null);
  const activeCode =
    active !== null && visible.some((material) => material.materialCode === active)
      ? active
      : visible.some((material) => material.materialCode === chosen)
        ? chosen
        : null;

  // 활성 행이 보이도록 목록만 스크롤 (scrollIntoView 는 모달 전체를 움직일 수 있어 직접 계산)
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeCode === null) return;
    const row = Array.from(list.querySelectorAll<HTMLElement>('[data-material-code]')).find(
      (el) => el.dataset.materialCode === activeCode,
    );
    if (!row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [activeCode]);

  const move = (delta: number | 'first' | 'last') => {
    if (visible.length === 0) return;
    const index = visible.findIndex((material) => material.materialCode === activeCode);
    let next: number;
    if (delta === 'first') next = 0;
    else if (delta === 'last') next = visible.length - 1;
    else if (index === -1) next = delta > 0 ? 0 : visible.length - 1;
    else next = Math.max(0, Math.min(visible.length - 1, index + delta));
    setActive(visible[next]!.materialCode);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        return;
      case 'PageDown':
        event.preventDefault();
        move(10);
        return;
      case 'PageUp':
        event.preventDefault();
        move(-10);
        return;
      case 'Enter':
        // 모달 폼의 암묵적 제출을 막는다 — 확정은 '확정' 버튼으로만. 한글 조합 중 Enter 도 무시
        event.preventDefault();
        if (event.nativeEvent.isComposing) return;
        if (activeCode !== null) onChosenChange(activeCode);
        return;
      default:
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={searchId} className="text-[12px] font-medium text-text-secondary">
        자재명·자재번호 검색
      </label>
      <Input
        id={searchId}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeCode !== null ? optionId(activeCode) : undefined}
        autoComplete="off"
        value={search}
        disabled={disabled}
        leading={<Icon name="search" />}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setSearch(event.target.value);
          setActive(null);
        }}
      />
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span id={labelId} className="text-[12px] font-medium text-text-secondary">
          원가 자재 ({matchCount}건)
        </span>
        {truncated ? (
          <span role="status" className="text-[12px] text-text-tertiary">
            {COST_LINK_PICKER_RENDER_MAX}건까지 표시 — 검색어를 좁혀 주세요
          </span>
        ) : null}
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={labelId}
        aria-disabled={disabled || undefined}
        className="max-h-[min(320px,45vh)] divide-y divide-border-subtle overflow-x-hidden overflow-y-auto rounded-xl bg-surface-card shadow-(--hairline-default)"
      >
        {matchCount === 0 ? (
          <p className="m-0 px-3 py-4 text-center text-[14px] text-text-tertiary">
            검색 결과가 없습니다
          </p>
        ) : null}
        {visible.length === 0
          ? null
          : visible.map((material) => {
              const selected = material.materialCode === chosen;
              const isActive = material.materialCode === activeCode;
              return (
                <div
                  key={material.materialCode}
                  id={optionId(material.materialCode)}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={disabled || undefined}
                  data-material-code={material.materialCode}
                  data-active={isActive ? '' : undefined}
                  // 포커스는 검색창에 둔 채 고른다 — 마우스 down 으로 검색창 포커스를 잃지 않게
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (disabled) return;
                    setActive(material.materialCode);
                    onChosenChange(material.materialCode);
                  }}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2',
                    selected ? 'bg-primary-600/8' : 'hover:bg-surface-muted',
                    isActive && 'shadow-[inset_0_0_0_2px_var(--purple-500)]',
                    disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-2 text-[14px] font-medium break-words text-text-primary">
                      {material.materialName}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] text-text-tertiary tabular-nums">
                        {material.materialCode}
                      </span>
                      {material.materialCode === currentCode ? (
                        <span className={cn(BADGE_CLASS, 'bg-neutral-100 text-text-primary')}>
                          현재
                        </span>
                      ) : null}
                      {material.materialCode === suggestedCode ? (
                        <span className={cn(BADGE_CLASS, 'bg-primary-50 text-primary-700')}>
                          제안
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {selected ? <CheckMark className="size-4 shrink-0 text-primary-600" /> : null}
                </div>
              );
            })}
      </div>
    </div>
  );
}
