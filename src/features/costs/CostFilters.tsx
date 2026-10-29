'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { Input } from '@/components/ui';
import { DateControls, type DateFilterValue } from '@/features/pricing/DateFilter';
import type { FilterErrors } from '@/features/pricing/filter';
import { ViewStateLink } from '@/features/page-state/ViewStateLink';
import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';
import { navigateView } from '@/lib/page-state/view-navigation';

import { costFilterToQuery } from './query';
import type { CostFamilyTab, CostFilterView } from './types';

type CostFiltersProps = {
  filter: CostFilterView;
  errors: FilterErrors;
  families: readonly CostFamilyTab[];
  years: readonly number[];
};

const COSTS_PATH = '/admin/costs';

/**
 * 원가 관리 필터 (§4.5.5): 제품군 탭(Q-03 파생) → 날짜 기준·연도 칩·기간(§4.5.2 공용 DateControls, R-14) → 검색.
 * 라인업 칩은 매핑 확정 전까지 숨긴다. 모든 상태는 URL.
 */
export function CostFilters({ filter, errors, families, years }: CostFiltersProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(filter.q ?? '');

  const go = (patch: Partial<CostFilterView & DateFilterValue>) =>
    navigateView(`${COSTS_PATH}${costFilterToQuery({ ...filter, ...patch, page: 1 })}`, (href) =>
      startTransition(() => router.push(href)),
    );

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    go({ q: query.trim() || undefined });
  };

  return (
    <div className="flex flex-col gap-4">
      <FamilyTabs filter={filter} families={families} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateControls filter={filter} errors={errors} years={years} onChange={go} />
        <form
          role="search"
          aria-label="원가 검색"
          onSubmit={submitSearch}
          className="w-full sm:w-[260px]"
        >
          <Input
            type="search"
            name="q"
            aria-label="원자재명·코드 검색"
            value={query}
            placeholder="원자재명, 코드로 검색"
            onChange={(event) => setQuery(event.target.value)}
            leading={<Icon name="search" />}
            className="bg-surface-card"
          />
        </form>
      </div>
    </div>
  );
}

function FamilyTabs({ filter, families }: Pick<CostFiltersProps, 'filter' | 'families'>) {
  const total = families.reduce((sum, tab) => sum + tab.count, 0);
  const tabs = [
    { family: '', count: total, label: '전체' },
    ...families.map((tab) => ({ ...tab, label: tab.family })),
  ];
  return (
    <nav aria-label="제품군" className="flex gap-1.5 overflow-x-auto border-b border-border-subtle">
      {tabs.map((tab) => {
        const active = (filter.family ?? '') === tab.family;
        return (
          <ViewStateLink
            key={tab.label}
            href={`${COSTS_PATH}${costFilterToQuery({ ...filter, family: tab.family || undefined, page: 1 })}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-[14px] whitespace-nowrap no-underline hover:no-underline',
              active
                ? 'border-neutral-900 font-semibold text-text-primary'
                : 'border-transparent font-medium text-text-tertiary hover:text-text-primary',
            )}
          >
            {tab.label}
            <span className="ml-1.5 text-[11px] font-normal text-text-tertiary">
              {tab.count.toLocaleString('ko-KR')}
            </span>
          </ViewStateLink>
        );
      })}
    </nav>
  );
}
