'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { productFamilyMajors } from '@/lib/constants/product-cards';
import { Input } from '@/components/ui';
import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';
import { navigateView } from '@/lib/page-state/view-navigation';

import { DateControls } from './DateFilter';
import { ALL, filterToQuery, type FilterErrors, type PriceFilter } from './filter';
import type { CategoryOptionsView } from './types';

type PricingFiltersProps = {
  filter: PriceFilter;
  errors: FilterErrors;
  options: CategoryOptionsView;
  years: readonly number[];
  searchPlaceholder: string;
};

type Patch = (patch: Partial<PriceFilter>) => void;

const SELECT_CLASS =
  'rounded-lg border-0 bg-surface-card px-3 py-[9px] text-[12px] shadow-(--hairline-default) outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--purple-500)] disabled:opacity-60';

/**
 * 조회·관리 공용 필터 (§4.5.1·§4.5.2): 대/중/소분류 연쇄 드롭다운(R-01), 날짜 기준 선택(R-13),
 * 전체·연도 칩(R-B), 기간 입력, 검색. 모든 상태는 URL 검색 파라미터로 반영하고 1페이지로 돌아간다.
 */
export function PricingFilters(props: PricingFiltersProps) {
  const { filter, errors, options, years, searchPlaceholder } = props;
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(filter.q ?? '');

  const go: Patch = (patch) =>
    navigateView(`${pathname}${filterToQuery({ ...filter, ...patch, page: 1 })}`, (href) =>
      startTransition(() => router.push(href)),
    );

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    go({ q: query.trim() || undefined });
  };

  return (
    <div className="flex flex-col gap-3.5">
      <CategoryCascade filter={filter} options={options} onChange={go} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateControls filter={filter} errors={errors} years={years} onChange={go} />
        <form
          role="search"
          aria-label="가격정책 검색"
          onSubmit={submitSearch}
          className="w-full sm:w-[260px]"
        >
          <Input
            type="search"
            name="q"
            aria-label="품목명·품번 검색"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            leading={<Icon name="search" />}
            className="bg-surface-card"
          />
        </form>
      </div>
    </div>
  );
}

type CategorySelectProps = {
  label: string;
  value: string | undefined;
  values: readonly string[];
  disabled?: boolean;
  bold?: boolean;
  onChange: (value: string) => void;
};

function CategorySelect({ label, value, values, disabled, bold, onChange }: CategorySelectProps) {
  return (
    <select
      aria-label={label}
      className={cn(SELECT_CLASS, bold && 'font-semibold')}
      value={value ?? ALL}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={ALL}>{ALL}</option>
      {values.map((entry) => (
        <option key={entry} value={entry}>
          {entry}
        </option>
      ))}
    </select>
  );
}

/** r5 §4.5.4 필터 배지: "제품군: iSIGN (iSIGN PKI 포함)" — family 만 있을 때 */
function familyBadge(family: string): string {
  const majors = productFamilyMajors(family) ?? [family];
  const [first, ...rest] = majors;
  return rest.length > 0 ? `${first} (${rest.join(', ')} 포함)` : String(first);
}

/** 상위 분류를 바꾸면 하위는 `전체`로 초기화 (디자인 로직 유지, AC-11) */
function CategoryCascade({
  filter,
  options,
  onChange,
}: {
  filter: PriceFilter;
  options: CategoryOptionsView;
  onChange: Patch;
}) {
  const noSub = !options.hasMaster;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <CategorySelect
        label="대분류"
        bold
        value={filter.major}
        values={options.majors}
        onChange={(major) =>
          onChange({ major, family: undefined, mid: undefined, minor: undefined })
        }
      />
      {filter.family ? (
        <span
          role="status"
          className="rounded-pill bg-warning-50 px-2.5 py-1 text-[12px] font-semibold text-warning-700"
        >
          제품군: {familyBadge(filter.family)}
        </span>
      ) : null}
      <CategorySelect
        label="중분류"
        value={filter.mid}
        values={options.mids}
        disabled={noSub || !filter.major}
        onChange={(mid) => onChange({ mid, minor: undefined })}
      />
      <CategorySelect
        label="소분류"
        value={filter.minor}
        values={options.minors}
        disabled={noSub || !filter.mid}
        onChange={(minor) => onChange({ minor })}
      />
      {noSub ? (
        <span className="text-[12px] text-text-tertiary">
          품목조회 파일이 적용되면 중/소분류 필터가 활성화됩니다
        </span>
      ) : null}
    </div>
  );
}
