import Link from 'next/link';

import { cn } from '@/lib/cn';

import type { NoticeView } from './types';

/** 디자인의 `중요` 배지 (accent-red 위 #fdeaec) */
export function ImportantBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-pill bg-red-500/12 px-2 py-[3px] text-[11px] font-semibold text-red-500',
        className,
      )}
    >
      중요
    </span>
  );
}

type NoticeRowsProps = {
  notices: readonly NoticeView[];
  /** 홈(compact)은 카드 안 13px 행, 목록은 16px/20px 행 */
  variant?: 'home' | 'list';
  emptyText?: string;
};

/** 공지 행 목록 (디자인 HOME 공지 / 공지사항 전체): 중요 배지 · 제목 · 작성자 · 작성일 → 상세 */
export function NoticeRows({ notices, variant = 'list', emptyText }: NoticeRowsProps) {
  if (notices.length === 0) {
    return (
      <p className="m-0 py-10 text-center text-[13px] text-text-tertiary">
        {emptyText ?? '등록된 공지가 없습니다.'}
      </p>
    );
  }
  return (
    <ul aria-label="공지 목록" className="m-0 flex list-none flex-col p-0">
      {notices.map((notice) => (
        <li key={notice.id} className="border-b border-border-subtle last:border-b-0">
          <Link
            href={`/notices/${notice.id}`}
            className={cn(
              'flex items-center gap-3 text-ink-900 no-underline hover:bg-gray-75 hover:no-underline',
              variant === 'home' ? 'px-1 py-[13px]' : 'px-5 py-4',
            )}
          >
            {notice.isImportant ? <ImportantBadge /> : null}
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{notice.title}</span>
            <span className="shrink-0 text-[12px] text-text-tertiary">{notice.authorName}</span>
            <span className="w-[90px] shrink-0 text-right text-[12px] text-text-tertiary">
              {notice.publishedAt}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
