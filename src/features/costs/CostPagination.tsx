import Link from 'next/link';

import { cn } from '@/lib/cn';

import { costFilterToQuery } from './query';
import type { CostFilterView } from './types';

type CostPaginationProps = {
  filter: CostFilterView;
  page: number;
  pageCount: number;
  total: number;
};

const BASE =
  'inline-flex h-8 items-center rounded-lg bg-gray-75 px-3 font-semibold no-underline shadow-(--hairline-subtle)';

export function CostPagination({ filter, page, pageCount, total }: CostPaginationProps) {
  const href = (target: number) => `/admin/costs${costFilterToQuery({ ...filter, page: target })}`;
  const links = [
    { label: '이전', target: page - 1, disabled: page <= 1 },
    { label: '다음', target: page + 1, disabled: page >= pageCount },
  ];
  return (
    <nav
      aria-label="페이지"
      className="flex items-center justify-between text-[12px] text-text-tertiary"
    >
      <span>
        총 {total.toLocaleString('ko-KR')}건 · {page} / {pageCount} 페이지
      </span>
      <div className="flex gap-2">
        {links.map(({ label, target, disabled }) =>
          disabled ? (
            <span
              key={label}
              aria-disabled="true"
              className={cn(BASE, 'text-text-tertiary opacity-50')}
            >
              {label}
            </span>
          ) : (
            <Link
              key={label}
              href={href(target)}
              className={cn(
                BASE,
                'text-text-secondary hover:bg-gray-100 hover:text-ink-900 hover:no-underline',
              )}
            >
              {label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}
