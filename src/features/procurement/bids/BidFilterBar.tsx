'use client';

import { useRouter } from 'next/navigation';
import { useRef, useTransition } from 'react';

import { Segmented } from '@/components/ui';
import { chipClass } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { navigateView } from '@/lib/page-state/view-navigation';
import {
  BID_SORT_OPTIONS,
  BID_STATUS_OPTIONS,
  bidsHref,
  type BidFilter,
} from '@/lib/procurement/bid-filter';
import type { ProcurementProduct } from '@/lib/procurement/constants';

export type BidFilterBarProps = {
  filter: BidFilter;
  productCounts: readonly { product: ProcurementProduct; count: number }[];
  allCount: number;
};

const countFormat = new Intl.NumberFormat('ko-KR');

/**
 * 입찰 공고 빠른 필터 바 (조달이 통합 UI-3): 제품 칩(건수) · 진행 중/마감 포함 · 적합도순/게시순 · 상만.
 * URL 이 상태다 — 조건을 바꾸면 1페이지로 `router.replace`(뒤로 가기 기록을 쌓지 않음, 빠른 필터 바 §2.3).
 * 칩 건수는 서버 집계(getBidNoticeRows.productCounts — 진행 중·상만 조건 반영, 제품 선택 미반영).
 */
export function BidFilterBar({ filter, productCounts, allCount }: BidFilterBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // 빠른 연속 조작(R1, 빠른 필터 바와 같은 규칙): URL 이 아직 바뀌지 않았으면 다음 조건은 마지막 요청에서 계산한다.
  // 요청을 보낸 뒤 URL 이 바뀌었으면(요청이 반영됐거나 뒤로 가기·복원 같은 외부 변경) 지금 URL 이 기준.
  const pending = useRef<{ target: BidFilter; fromHref: string } | null>(null);

  const apply = (next: Partial<BidFilter>) => {
    const currentHref = bidsHref({ ...filter, page: 1 });
    const last = pending.current;
    const base = last && last.fromHref === currentHref ? last.target : filter;
    const target: BidFilter = { ...base, ...next, page: 1 };
    pending.current = { target, fromHref: currentHref };
    navigateView(bidsHref(target), (href) =>
      startTransition(() => router.replace(href, { scroll: false })),
    );
  };

  const chips: { product: ProcurementProduct | null; label: string; count: number }[] = [
    { product: null, label: '전체', count: allCount },
    ...productCounts.map(({ product, count }) => ({ product, label: product, count })),
  ];

  return (
    <div
      role="group"
      aria-label="입찰 공고 조건"
      aria-busy={isPending || undefined}
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      <div role="group" aria-label="제품" className="flex min-w-0 flex-wrap gap-1.5">
        {chips.map((chip) => {
          const active = filter.product === chip.product;
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={active}
              aria-label={`${chip.label} ${countFormat.format(chip.count)}건`}
              onClick={() => {
                if (!active) apply({ product: chip.product });
              }}
              className={cn(chipClass(active), 'inline-flex items-center gap-1.5')}
            >
              <span>{chip.label}</span>
              <span
                className={cn(
                  'tabular-nums',
                  active ? 'text-text-inverse/80' : 'text-text-tertiary',
                )}
              >
                {countFormat.format(chip.count)}
              </span>
            </button>
          );
        })}
      </div>
      <Segmented
        aria-label="마감 여부"
        options={BID_STATUS_OPTIONS}
        value={filter.includeClosed ? 'all' : 'open'}
        onChange={(value) => apply({ includeClosed: value === 'all' })}
      />
      <Segmented
        aria-label="정렬"
        options={BID_SORT_OPTIONS}
        value={filter.sort}
        onChange={(sort) => apply({ sort })}
      />
      <button
        type="button"
        aria-pressed={filter.topGradeOnly}
        title="적합도 '상' 공고만 보기"
        onClick={() => apply({ topGradeOnly: !filter.topGradeOnly })}
        className={chipClass(filter.topGradeOnly)}
      >
        상만
      </button>
    </div>
  );
}
