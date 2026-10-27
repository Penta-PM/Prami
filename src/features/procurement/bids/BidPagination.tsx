import { ViewStateLink } from '@/features/page-state/ViewStateLink';
import { cn } from '@/lib/cn';
import { bidsHref, type BidFilter } from '@/lib/procurement/bid-filter';

type BidPaginationProps = { filter: BidFilter; page: number; pageCount: number; total: number };

/** 이전/다음 + 현재 위치 (서버 페이지네이션). 페이지 이동도 URL 상태 — 감사 로그 페이지 이동과 같은 방식(push) */
export function BidPagination({ filter, page, pageCount, total }: BidPaginationProps) {
  const href = (target: number) => bidsHref({ ...filter, page: target });
  return (
    <nav
      aria-label="페이지"
      className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-tertiary"
    >
      <span className="tabular-nums">
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
    <ViewStateLink
      href={href}
      className={cn(
        PAGE_LINK_BASE,
        'text-text-secondary hover:bg-gray-100 hover:text-ink-900 hover:no-underline',
      )}
    >
      {label}
    </ViewStateLink>
  );
}
