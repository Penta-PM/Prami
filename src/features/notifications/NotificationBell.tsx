'use client';

import { m } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';

import { Presence } from '@/components/motion/Presence';
import { ImportantBadge } from '@/features/notices/NoticeRows';
import { Icon } from '@/components/icons/Icon';
import { LegacyIcon, type LegacyIconName } from '@/features/shell/icons';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/date-format';
import { fadeUp, VARIANT_KEYS } from '@/lib/motion/tokens';

import type { NotificationItemView, NotificationType } from './types';
import { useNotifications } from './useNotifications';

/** 유형 배지(28px 원 안 14px) — 20px 가 들어가지 않아 기존 아이콘 유지 (디자인 PR-3 작은 크기 유지 자리) */
const TYPE_ICON: Record<NotificationType, LegacyIconName> = {
  'notice.created': 'bell',
  'policy.applied': 'tag',
  'user.role_changed': 'users',
};

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
/** 모달(<dialog open>)·드로어(aria-modal) 가 열려 있으면 그쪽 Escape 가 우선이다 (#30 패턴) */
const MODAL_SELECTOR = 'dialog[open], [aria-modal="true"]';

/** 버튼 접근성 이름 (#31 스펙 §4 UI) */
export function notificationBellLabel(unreadCount: number): string {
  if (unreadCount <= 0) return '알림';
  if (unreadCount > 99) return '알림 99개 이상 안 읽음';
  return `알림 ${unreadCount}개 안 읽음`;
}

/**
 * 헤더 알림 버튼 + 드롭다운 (#31 스펙 §4 UI — NotificationBell). 비모달 dialog — 포커스 트랩 없음.
 * - 배지는 SSR 하지 않는다: 첫 렌더는 이름 "알림" 의 종만, 개수는 클라이언트 조회 뒤에 그린다.
 * - 단독 동작: 헤더 챗봇 버튼·도킹 패널이 없어져(UX PR-C2) #31 의 챗 패널 상호 배제 결합을 걷어 냈다.
 */
export function NotificationBell() {
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);

  const { unreadCount, items, status, refresh, markRead, markAllRead } = useNotifications(isOpen);
  const bellRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    bellRef.current?.focus();
  }, []);

  const toggle = () => setOpen((current) => !current);

  // 열면 드롭다운의 첫 요소로 포커스 (없으면 dialog 자신)
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus();
  }, [isOpen]);

  // Escape 닫기 + 포커스 복원. 모달이 열려 있으면 처리하지 않는다
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector(MODAL_SELECTOR)) return;
      closeAndRestoreFocus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, closeAndRestoreFocus]);

  // 바깥 클릭 닫기. 클릭으로 다른 컨트롤에 포커스가 갔으면 빼앗지 않고, 아니면(빈 곳·드롭다운 안) 종 버튼으로 돌려준다
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (target && wrapperRef.current?.contains(target)) return;
      const active = document.activeElement;
      const focusElsewhere =
        active && active !== document.body && !wrapperRef.current?.contains(active);
      if (focusElsewhere) close();
      else closeAndRestoreFocus();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [isOpen, close, closeAndRestoreFocus]);

  const onItemClick = async (event: MouseEvent<HTMLAnchorElement>, item: NotificationItemView) => {
    // 새 탭 열기(수정키·가운데 버튼)는 브라우저 기본 동작에 맡기고 읽음 처리만 한다
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      void markRead(item.id);
      return;
    }
    event.preventDefault();
    await markRead(item.id);
    router.push(item.href);
    close();
  };

  const badge = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onBlur={(event) => {
        // Tab 으로 드롭다운(종 포함)을 벗어나면 닫는다. relatedTarget 이 없으면(빈 곳 클릭·창 전환) 바깥 클릭 처리에 맡긴다
        const next = event.relatedTarget as Node | null;
        if (isOpen && next && !event.currentTarget.contains(next)) close();
      }}
    >
      <button
        ref={bellRef}
        type="button"
        title="알림"
        aria-label={notificationBellLabel(unreadCount)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={toggle}
        className="relative flex size-9 items-center justify-center rounded-pill border-0 bg-gray-75 text-text-secondary shadow-(--hairline-subtle) hover:text-ink-900 aria-expanded:text-ink-900"
      >
        <Icon name="bell" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            data-testid="notification-badge"
            className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-red-600 px-1 text-[10px] leading-none font-semibold text-white"
          >
            {badge}
          </span>
        ) : null}
      </button>
      <Presence>
        {isOpen ? (
          <m.div
            key="notification-panel"
            ref={panelRef}
            role="dialog"
            aria-label="알림"
            aria-busy={status === 'loading' ? true : undefined}
            tabIndex={-1}
            variants={fadeUp}
            initial={VARIANT_KEYS.initial}
            animate={VARIANT_KEYS.animate}
            exit={VARIANT_KEYS.exit}
            className={cn(
              'z-40 flex max-h-[min(480px,70vh)] flex-col overflow-hidden rounded-xl bg-surface-card shadow-(--shadow-elevated) outline-none',
              'max-md:fixed max-md:top-[72px] max-md:right-4 max-md:left-4',
              'md:absolute md:top-full md:right-0 md:mt-2 md:w-[360px]',
            )}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
              <h2 className="m-0 text-[14px] font-semibold">알림</h2>
              <button
                type="button"
                disabled={unreadCount === 0}
                onClick={() => void markAllRead()}
                className="rounded-lg border-0 bg-transparent px-2 py-1 text-[12px] font-semibold text-text-secondary hover:bg-gray-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:text-text-tertiary disabled:hover:bg-transparent"
              >
                모두 읽음
              </button>
            </div>
            <NotificationBody
              status={status}
              items={items}
              onRetry={() => void refresh()}
              onItemClick={onItemClick}
            />
          </m.div>
        ) : null}
      </Presence>
    </div>
  );
}

function NotificationBody({
  status,
  items,
  onRetry,
  onItemClick,
}: {
  status: ReturnType<typeof useNotifications>['status'];
  items: readonly NotificationItemView[];
  onRetry: () => void;
  onItemClick: (event: MouseEvent<HTMLAnchorElement>, item: NotificationItemView) => void;
}) {
  if (status === 'loading') {
    return <p className="m-0 px-4 py-6 text-center text-[13px] text-text-tertiary">불러오는 중…</p>;
  }
  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 px-4 py-6 text-center">
        <p className="m-0 text-[13px] text-text-secondary">알림을 불러오지 못했습니다.</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border-0 bg-gray-75 px-3 py-1.5 text-[12px] font-semibold text-ink-900 shadow-(--hairline-subtle) hover:bg-gray-100"
        >
          다시 시도
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="m-0 px-4 py-6 text-center text-[13px] text-text-tertiary">
        새 알림이 없습니다.
      </p>
    );
  }
  return (
    <ul aria-label="알림 목록" className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
      {items.map((item) => (
        <li key={item.id} className="border-b border-border-subtle last:border-b-0">
          <a
            href={item.href}
            data-unread={item.read ? undefined : 'true'}
            onClick={(event) => onItemClick(event, item)}
            className={cn(
              'flex min-w-0 items-start gap-3 px-4 py-3 text-ink-900 no-underline hover:bg-gray-75',
              !item.read && 'bg-purple-500/6',
            )}
          >
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-circle bg-gray-75 text-text-secondary"
            >
              <LegacyIcon name={TYPE_ICON[item.type] ?? 'bell'} className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                {item.important ? <ImportantBadge /> : null}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[13px]',
                    item.read ? 'font-medium' : 'font-semibold',
                  )}
                >
                  {item.title}
                </span>
                {item.read ? null : (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-circle bg-purple-600"
                  />
                )}
              </span>
              {item.body ? (
                <span className="truncate text-[12px] text-text-secondary">{item.body}</span>
              ) : null}
              <span className="text-[11px] text-text-tertiary">
                <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                {item.read ? null : <span className="sr-only"> 안 읽음</span>}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
