'use client';

import { Button } from '../button';

/** 빈 상태 [필터 초기화] 뒤 포커스를 옮길 가장 가까운 필터 바 트리거(빠른 필터 바의 필드 버튼·＋N개 더) */
function nearestFilterTrigger(from: HTMLElement): HTMLElement | null {
  for (let node = from.parentElement; node; node = node.parentElement) {
    const trigger = node.querySelector<HTMLElement>('[data-table-filter-trigger]');
    if (trigger) return trigger;
  }
  return null;
}

/**
 * 필터 결과 0건 빈 상태 (스펙 §2.5-7). 데이터 자체가 없을 때의 "등록된 … 없습니다" 와 구분한다.
 * [필터 초기화] 뒤에는 이 버튼이 사라지므로 가장 가까운 필터 바 트리거(빠른 필터 바의 필드 버튼)로 포커스를 옮긴다(A-1 QA 백로그)
 */
export function DataTableFilterEmpty({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="m-0 text-[13px] text-text-tertiary">조건에 맞는 결과가 없습니다</p>
      <Button
        size="sm"
        onClick={(event) => {
          const trigger = nearestFilterTrigger(event.currentTarget);
          onReset();
          trigger?.focus();
        }}
      >
        필터 초기화
      </Button>
    </div>
  );
}
