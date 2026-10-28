import { FOCUS_RING_CLASSES } from '@/components/ui';
import { controlSizeClasses } from '@/components/ui/density';
import { ViewStateLink } from '@/features/page-state/ViewStateLink';
import { cn } from '@/lib/cn';

import { filterToQuery, type PriceFilter } from './filter';

type PricingPaginationProps = {
  basePath: string;
  filter: PriceFilter;
  page: number;
  pageCount: number;
  total: number;
};

/** 표 페이지 이동 — Ghost 버튼 모양(N50·N700·N200), 표 아래 밀집 영역이라 sm(36·14) */
const BASE = cn(
  'inline-flex items-center rounded-control border border-solid border-neutral-200 bg-neutral-50 px-4 font-semibold no-underline',
  controlSizeClasses('sm'),
);

/** 서버 페이지네이션 (50행) — 총건수 표시, 이동은 URL 상태 */
export function PricingPagination({
  basePath,
  filter,
  page,
  pageCount,
  total,
}: PricingPaginationProps) {
  const href = (target: number) => `${basePath}${filterToQuery({ ...filter, page: target })}`;
  return (
    <nav
      aria-label="페이지"
      className="flex items-center justify-between text-[12px] text-text-tertiary"
    >
      <span>
        총 {total.toLocaleString('ko-KR')}건 · {page} / {pageCount} 페이지
      </span>
      <div className="flex gap-2">
        {[
          { label: '이전', target: page - 1, disabled: page <= 1 },
          { label: '다음', target: page + 1, disabled: page >= pageCount },
        ].map(({ label, target, disabled }) =>
          disabled ? (
            <span
              key={label}
              aria-disabled="true"
              className={cn(BASE, 'text-neutral-700 opacity-50')}
            >
              {label}
            </span>
          ) : (
            <ViewStateLink
              key={label}
              href={href(target)}
              className={cn(
                BASE,
                'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 hover:no-underline',
                FOCUS_RING_CLASSES,
              )}
            >
              {label}
            </ViewStateLink>
          ),
        )}
      </div>
    </nav>
  );
}
