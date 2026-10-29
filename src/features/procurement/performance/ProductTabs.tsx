'use client';

import { cn } from '@/lib/cn';
import {
  ISIGN_PRODUCT_GROUPS,
  PROCUREMENT_PRODUCT_TABS,
  type IsignProductGroup,
  type ProcurementProductTab,
} from '@/lib/procurement/constants';

/** 탭 이름 (원본 PRODUCT_LABEL — ALL = 전체) */
export const PRODUCT_TAB_LABEL: Record<ProcurementProductTab, string> = {
  ALL: '전체',
  WAPPLES: 'WAPPLES',
  'D.AMO': 'D.AMO',
  iSIGN: 'iSIGN',
};

/** 보고표 제목 등에 쓰는 범위 이름 — iSIGN 세부 그룹이면 `iSIGN · SSO` (원본 chartLabel) */
export function scopeLabel(tab: ProcurementProductTab, group: IsignProductGroup | null): string {
  return tab === 'iSIGN' && group ? `iSIGN · ${group}` : PRODUCT_TAB_LABEL[tab];
}

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

/**
 * 제품 탭 (원본 ProductTabs — STATS_TABS: 전체·WAPPLES·D.AMO·iSIGN) + iSIGN 세부 그룹 탭 (원본 IsignGroupTabs — 고른 그룹을
 * 다시 누르면 전체로). 누르면 URL 이 바뀐다(선택 = aria-pressed). 좁은 화면에서는 줄바꿈.
 */
export function ProductTabs({
  tab,
  group,
  onTabChange,
  onGroupChange,
}: {
  tab: ProcurementProductTab;
  group: IsignProductGroup | null;
  onTabChange: (tab: ProcurementProductTab) => void;
  onGroupChange: (group: IsignProductGroup | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        role="group"
        aria-label="제품"
        className="flex min-w-0 flex-wrap gap-1 border-b border-border-default"
      >
        {PROCUREMENT_PRODUCT_TABS.map((value) => {
          const active = value === tab;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (!active) onTabChange(value);
              }}
              className={cn(
                '-mb-px border-0 border-b-2 bg-transparent px-4 py-2.5 text-[16px] whitespace-nowrap',
                active
                  ? 'border-accent-primary-strong font-semibold text-text-primary'
                  : 'border-transparent font-medium text-text-tertiary hover:text-text-primary',
                FOCUS,
              )}
            >
              {PRODUCT_TAB_LABEL[value]}
            </button>
          );
        })}
      </div>
      {tab === 'iSIGN' && (
        <div role="group" aria-label="iSIGN 세부 그룹" className="flex min-w-0 flex-wrap gap-1.5">
          {[null, ...ISIGN_PRODUCT_GROUPS].map((value) => {
            const active = value === group;
            return (
              <button
                key={value ?? 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => onGroupChange(value === group ? null : value)}
                className={cn(
                  'rounded-pill border px-3.5 py-1.5 text-[14px] whitespace-nowrap',
                  active
                    ? 'border-border-default bg-surface-muted font-bold text-text-primary'
                    : 'border-transparent bg-transparent font-medium text-text-tertiary hover:text-text-primary',
                  FOCUS,
                )}
              >
                {value ?? '전체'}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
