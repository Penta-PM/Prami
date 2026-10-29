import { FOCUS_RING_CLASSES } from '@/components/ui';
import { controlSizeClasses } from '@/components/ui/density';
import { ViewStateLink } from '@/features/page-state/ViewStateLink';
import { cn } from '@/lib/cn';
import type { AuditFilter } from '@/server/audit/queries';

import { filterToQuery } from './query';

type AuditPaginationProps = { filter: AuditFilter; page: number; pageCount: number; total: number };

/** 이전/다음 + 현재 위치. 페이지 이동도 URL 상태로 처리한다 */
export function AuditPagination({ filter, page, pageCount, total }: AuditPaginationProps) {
  const href = (target: number) => `/admin/audit${filterToQuery({ ...filter, page: target })}`;
  return (
    <nav
      aria-label="페이지"
      className="flex items-center justify-between text-[12px] text-text-tertiary"
    >
      <span>
        총 {total.toLocaleString('ko-KR')}건 · {page} / {pageCount} 페이지
      </span>
      <div className="flex gap-2">
        <PageLink href={href(page - 1)} disabled={page <= 1} label="이전" />
        <PageLink href={href(page + 1)} disabled={page >= pageCount} label="다음" />
      </div>
    </nav>
  );
}

/** 표 페이지 이동 — Ghost 버튼 모양, 표 아래 밀집 영역이라 sm(36·14) */
const PAGE_LINK_BASE = cn(
  'inline-flex items-center rounded-control border border-solid border-neutral-200 bg-neutral-50 px-4 font-semibold no-underline',
  controlSizeClasses('sm'),
);

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(PAGE_LINK_BASE, 'text-neutral-700 opacity-50')}>
        {label}
      </span>
    );
  }
  return (
    <ViewStateLink
      href={href}
      className={cn(
        PAGE_LINK_BASE,
        'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 hover:no-underline',
        FOCUS_RING_CLASSES,
      )}
    >
      {label}
    </ViewStateLink>
  );
}
