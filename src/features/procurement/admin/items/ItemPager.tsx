'use client';

import { Button } from '@/components/ui';

/** 이전/다음 + 현재 위치 (서버 페이지네이션 — 품목 관리 탭 안 상태라 URL 을 바꾸지 않는다) */
export function ItemPager({
  page,
  pageCount,
  total,
  label,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  label: string;
  onPage: (page: number) => void;
}) {
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-tertiary"
    >
      <span className="tabular-nums">
        총 {total.toLocaleString('ko-KR')}건 · {page} / {pageCount} 페이지
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          이전
        </Button>
        <Button size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          다음
        </Button>
      </div>
    </nav>
  );
}
