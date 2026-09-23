import Link from 'next/link';

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

const PAGE_LINK_BASE =
  'inline-flex h-8 items-center rounded-lg bg-gray-75 px-3 font-semibold no-underline shadow-(--hairline-subtle)';

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(PAGE_LINK_BASE, 'text-text-tertiary opacity-50')}>
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        PAGE_LINK_BASE,
        'text-text-secondary hover:bg-gray-100 hover:text-ink-900 hover:no-underline',
      )}
    >
      {label}
    </Link>
  );
}
