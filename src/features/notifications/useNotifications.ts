'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { markAllNotificationsReadAction, markNotificationReadAction } from './actions';
import {
  NOTIFICATION_LIST_LIMIT,
  NOTIFICATIONS_API_PATH,
  type NotificationItemView,
  type NotificationsResponse,
} from './types';

/** 폴링 간격 (#31 스펙 §4 전달 방식 — 폴링) */
export const NOTIFICATION_POLL_MS = 60_000;

export type NotificationsStatus = 'loading' | 'ready' | 'error';

const ENDPOINT = `${NOTIFICATIONS_API_PATH}?limit=${NOTIFICATION_LIST_LIMIT}`;

/** 봉투(`{ ok, data }`)와 맨 응답(`{ unreadCount, items }`)을 모두 받는다 — 형태가 다르면 오류로 본다 */
function parseResponse(body: unknown): NotificationsResponse | null {
  const raw =
    body && typeof body === 'object' && 'ok' in body
      ? (body as { ok: boolean; data?: unknown }).ok
        ? (body as { data?: unknown }).data
        : null
      : body;
  if (!raw || typeof raw !== 'object') return null;
  const { unreadCount, items } = raw as Partial<NotificationsResponse>;
  if (typeof unreadCount !== 'number' || !Array.isArray(items)) return null;
  return { unreadCount, items };
}

/**
 * 앱 내 알림 폴링 훅 (#31 스펙 §4). 선례는 useChatStatus.
 * - 마운트 시 1회, 탭이 visible 인 동안 60초 간격, `focus`·`visibilitychange`(visible) 와 드롭다운을 열 때 즉시 조회한다.
 * - 탭이 hidden 이면 interval 을 멈춘다(요청 0).
 * - 폴링 오류(점검 503·네트워크 등)는 상태에만 남는다 — 화면에 드러낼지는 호출부(드롭다운 열림 여부)가 정한다.
 * - 읽음 처리는 서버 액션을 부르고 낙관적으로 갱신한 뒤 응답의 unreadCount 로 맞춘다.
 */
export function useNotifications(isOpen: boolean) {
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  // 늦게 도착한 이전 응답이 최신 상태(읽음 처리 포함)를 덮지 않게 요청마다 번호를 붙인다
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const response = await fetch(ENDPOINT, { cache: 'no-store' });
      const parsed = response.ok ? parseResponse(await response.json()) : null;
      if (seq !== seqRef.current) return;
      if (parsed) {
        setData(parsed);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      if (seq === seqRef.current) setFailed(true);
    }
  }, []);

  /** 다시 시도·드롭다운 열기: 이전 오류를 지우고 조회한다(데이터가 없으면 로딩 상태로 보인다) */
  const retry = useCallback(() => {
    setFailed(false);
    return refresh();
  }, [refresh]);

  // 마운트 1회 + visible 동안 60초 interval + focus/visibilitychange 즉시 조회
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(() => void refresh(), NOTIFICATION_POLL_MS);
    };
    const isVisible = () => document.visibilityState === 'visible';

    // 조회 결과는 비동기 콜백에서 반영한다 (effect 본문에서 동기 setState 없음)
    const first = setTimeout(() => void refresh(), 0);
    if (isVisible()) start();

    const onVisibility = () => {
      if (isVisible()) {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => {
      if (isVisible()) void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(first);
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  // 드롭다운을 열 때 즉시 조회 (이전 오류는 지우고 다시 받는다)
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => void retry(), 0);
    return () => clearTimeout(timer);
  }, [isOpen, retry]);

  const applyUnread = useCallback((unreadCount: number) => {
    setData((current) => (current ? { ...current, unreadCount } : current));
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      const target = data?.items.find((item) => item.id === id);
      if (!target || target.read) return;
      seqRef.current += 1;
      setData((current) =>
        current
          ? {
              unreadCount: Math.max(0, current.unreadCount - 1),
              items: current.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
            }
          : current,
      );
      try {
        const result = await markNotificationReadAction({ id });
        if (result.ok) applyUnread(result.data.unreadCount);
      } catch {
        // 읽음 처리 실패는 다음 폴링이 바로잡는다 (이동은 막지 않는다)
      }
    },
    [data, applyUnread],
  );

  const markAllRead = useCallback(async () => {
    seqRef.current += 1;
    setData((current) =>
      current
        ? { unreadCount: 0, items: current.items.map((item) => ({ ...item, read: true })) }
        : current,
    );
    try {
      const result = await markAllNotificationsReadAction();
      if (result.ok) applyUnread(result.data.unreadCount);
    } catch {
      // 다음 폴링이 바로잡는다
    }
  }, [applyUnread]);

  const status: NotificationsStatus = failed ? 'error' : data ? 'ready' : 'loading';
  const items: NotificationItemView[] = data?.items ?? [];

  return {
    unreadCount: data?.unreadCount ?? 0,
    items,
    status,
    refresh: retry,
    markRead,
    markAllRead,
  };
}
