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

const BASE =
  'inline-flex h-8 items-center rounded-lg bg-gray-75 px-3 font-semibold no-underline shadow-(--hairline-subtle)';

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
              className={cn(BASE, 'text-text-tertiary opacity-50')}
            >
              {label}
            </span>
          ) : (
            <ViewStateLink
              key={label}
              href={href(target)}
              className={cn(
                BASE,
                'text-text-secondary hover:bg-gray-100 hover:text-ink-900 hover:no-underline',
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
