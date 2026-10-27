'use client';

import { useId, useState } from 'react';

import { Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ISIGN_DETAIL_CATEGORIES, isIsignDetailCategory } from '@/lib/procurement/item-admin';

const CELL_INPUT =
  'w-full min-w-[120px] rounded-lg border-0 bg-gray-75 px-2.5 py-1.5 text-[13px] text-ink-900 shadow-(--hairline-default) outline-none placeholder:text-text-tertiary focus-visible:shadow-[inset_0_0_0_1px_var(--purple-500)]';

/** iSIGN 세부분류 선택 (목록 8개). 목록 밖 값이면 "(선택 필요)" 로 보여 준다 — 원본 IsignCategorySelect */
export function IsignCategorySelect({
  value,
  onChange,
  label,
  emptyLabel = '세부분류 선택',
  allowEmpty = false,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  emptyLabel?: string;
  /** 빈 값을 고를 수 있는지 (일괄 변경의 "변경 안 함") */
  allowEmpty?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const known = isIsignDetailCategory(value);
  return (
    <Select
      aria-label={label}
      value={known ? value : ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cn('py-1.5 text-[13px]', !known && !allowEmpty && 'text-red-600', className)}
    >
      <option value="" disabled={!allowEmpty}>
        {value && !known ? `${value} (선택 필요)` : emptyLabel}
      </option>
      {ISIGN_DETAIL_CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {category}
        </option>
      ))}
    </Select>
  );
}

/**
 * 표 칸의 세부분류 편집 — 바로 입력해서 저장(Enter 또는 칸을 벗어나면 저장, Esc 는 취소). 같은 제품에서 이미 쓰는 세부분류를
 * 제안 목록(datalist)으로 보여 표기가 흩어지지 않게 한다. iSIGN 은 목록에서만 고른다 (원본 DetailCell).
 */
export function DetailCategoryCell({
  value,
  product,
  options,
  label,
  disabled,
  onCommit,
}: {
  value: string | null;
  product: string;
  options: readonly string[];
  label: string;
  disabled?: boolean;
  onCommit: (value: string | null) => void;
}) {
  const listId = useId();
  const current = value ?? '';
  const [draft, setDraft] = useState(current);
  const [base, setBase] = useState(current);
  // 서버 값이 바뀌면(저장·새로고침) 입력도 맞춘다 — effect 대신 렌더 중 비교 (React 권장 패턴)
  if (base !== current) {
    setBase(current);
    setDraft(current);
  }

  if (product === 'iSIGN') {
    return (
      <IsignCategorySelect
        value={current}
        label={label}
        disabled={disabled}
        onChange={(next) => onCommit(next || null)}
      />
    );
  }
  const commit = () => {
    const next = draft.trim();
    if (next !== current.trim()) onCommit(next || null);
  };
  return (
    <>
      <input
        aria-label={label}
        value={draft}
        list={listId}
        disabled={disabled}
        placeholder="세부분류 입력"
        title="세부분류 — 입력 후 Enter"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(current);
            const target = event.currentTarget;
            setTimeout(() => target.blur(), 0);
          }
        }}
        className={CELL_INPUT}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}
