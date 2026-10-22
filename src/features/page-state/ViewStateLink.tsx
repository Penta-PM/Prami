'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps, MouseEvent } from 'react';

import {
  beforeViewNavigation,
  flushPendingView,
  navigateView,
} from '@/lib/page-state/view-navigation';

export type ViewStateLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  const target = event.currentTarget.getAttribute('target');
  return (
    (target !== null && target !== '_self') ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * 화면 안 이동 링크(페이지·제품군 탭) — 빈 쿼리로 가는 클릭이면 빈 상태 저장을 기다린 뒤 이동한다(page-state-memory §6).
 * 같은 표에 대기 중인 열 필터 변경이 있으면 그 조건을 합친 주소로 이동한다(빠른 필터 바 §6 #7).
 * 그 밖의 클릭(쿼리가 있는 이동·새 탭 열기)은 next/link 그대로.
 */
export function ViewStateLink({ href, onClick, ...props }: ViewStateLinkProps) {
  const router = useRouter();
  return (
    <Link
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || isModifiedClick(event)) return;
        // 같은 표에 대기 중인(디바운스) 열 필터 변경이 있으면 합친 주소로 이동한다(빠른 필터 바 §6 #7)
        const flushed = flushPendingView(href);
        if (flushed !== href) {
          event.preventDefault();
          navigateView(flushed, (next) => router.push(next));
          return;
        }
        const pending = beforeViewNavigation(href);
        if (!pending) return;
        event.preventDefault();
        void pending.then(() => router.push(href));
      }}
    />
  );
}
