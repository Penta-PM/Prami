import { FOCUS_RING_CLASSES } from '@/components/ui';
import { controlSizeClasses } from '@/components/ui/density';
import { ViewStateLink } from '@/features/page-state/ViewStateLink';
import { cn } from '@/lib/cn';

import { itemsViewToQuery, PROCUREMENT_ITEMS_PATH, type ItemsView } from './filter';

type ItemsPaginationProps = {
  view: ItemsView;
  page: number;
  pageCount: number;
  total: number;
};

/** 표 페이지 이동 — Ghost 버튼 모양, 표 아래 밀집 영역이라 sm(36·14) */
const BASE = cn(
  'inline-flex items-center rounded-control border border-solid border-neutral-200 bg-neutral-50 px-4 font-semibold no-underline',
  controlSizeClasses('sm'),
);

/** 등록 품목 페이지 이동 (서버 페이지네이션 — 링크 = push, 현재 검색·필터·정렬 유지) */
export function ItemsPagination({ view, page, pageCount, total }: ItemsPaginationProps) {
  const href = (target: number) =>
    `${PROCUREMENT_ITEMS_PATH}${itemsViewToQuery({ ...view, page: target })}`;
  const links = [
    { label: '이전', target: page - 1, disabled: page <= 1 },
    { label: '다음', target: page + 1, disabled: page >= pageCount },
  ];
  return (
    <nav
      aria-label="페이지"
      className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-tertiary"
    >
      <span className="tabular-nums">
        총 {total.toLocaleString('ko-KR')}건 · {page} / {pageCount} 페이지
      </span>
      <div className="flex gap-2">
        {links.map(({ label, target, disabled }) =>
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
