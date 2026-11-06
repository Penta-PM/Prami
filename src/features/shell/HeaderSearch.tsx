'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Icon } from '@/components/icons/Icon';
import { FOCUS_RING_CLASSES, PRESS_CLASSES } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/** 모바일 헤더 아이콘 버튼 — 44px 터치 영역 (Q-D1-M) */
export const HEADER_ICON_BUTTON_CLASSES = cn(
  'flex size-11 shrink-0 items-center justify-center rounded-pill border-0 bg-surface-muted text-[18px] text-text-secondary shadow-(--hairline-subtle) hover:text-text-primary',
  PRESS_CLASSES,
  FOCUS_RING_CLASSES,
);

/**
 * 헤더 통합 검색. 768px 이상은 기존 검색창 그대로. `max-md`(모바일 UI 스펙 §3 헤더)는 검색 아이콘만 두고, 누르면 헤더 위에
 * 검색창을 펼친다(☰ 오른쪽부터 끝까지). 펼침·접힘은 CSS 클래스로만 바뀐다 — 데스크톱에서는 펼침 상태가 생기지 않는다(버튼이 md:hidden).
 */
export function HeaderSearch() {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const collapse = () => {
    setExpanded(false);
    openButtonRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      collapse();
    }
  };

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        aria-label="검색 열기"
        aria-expanded={expanded}
        onClick={() => setExpanded(true)}
        className={cn(HEADER_ICON_BUTTON_CLASSES, 'md:hidden', expanded && 'hidden')}
      >
        <Icon name="search" />
      </button>
      <form
        role="search"
        action="/search"
        method="get"
        onKeyDown={onKeyDown}
        data-expanded={expanded}
        className={cn(
          'max-w-[480px] min-w-0 flex-1',
          expanded
            ? 'max-md:absolute max-md:top-(--safe-top) max-md:right-0 max-md:bottom-0 max-md:left-16 max-md:z-10 max-md:flex max-md:max-w-none max-md:items-center max-md:gap-2 max-md:bg-surface-page max-md:pr-3'
            : 'max-md:hidden',
        )}
      >
        <Input
          ref={inputRef}
          type="search"
          name="q"
          aria-label="통합 검색"
          placeholder="제품, 모델, 가격정책, 공지사항 검색"
          leading={<Icon name="search" />}
          wrapperClassName="max-md:min-w-0 max-md:flex-1"
        />
        {expanded ? (
          <button
            type="button"
            aria-label="검색 닫기"
            onClick={collapse}
            className={cn(HEADER_ICON_BUTTON_CLASSES, 'md:hidden')}
          >
            <Icon name="close" />
          </button>
        ) : null}
      </form>
    </>
  );
}
