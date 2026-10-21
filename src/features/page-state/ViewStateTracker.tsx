'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  APP_MAIN_ID,
  PAGE_PATHS,
  VIEW_SAVE_DEBOUNCE_MS,
  type PageKey,
} from '@/lib/page-state/keys';
import { registerEmptyViewSave } from '@/lib/page-state/view-navigation';

import { saveViewScrollAction, saveViewStateAction } from './actions';

export type ViewStateTrackerProps = {
  pageKey: PageKey;
  /** 서버에 저장된 쿼리 — 같은 값이면 다시 저장하지 않는다 */
  savedQuery: string | null;
  /** 복원할 `<main>` 스크롤 위치 (현재 조건 == 저장 조건일 때만 서버가 넘긴다) */
  restoreTop: number | null;
};

function mainElement(): HTMLElement | null {
  return document.getElementById(APP_MAIN_ID);
}

/**
 * 조회 상태 저장·스크롤 복원 (page-state-memory §2.2-3·5, §2.3). 화면 RSC 가 restoreViewState 결과로 렌더한다. 화면에는 아무것도 그리지 않는다.
 * - URL 쿼리가 바뀌면 500ms 뒤 저장(디바운스). 빈 쿼리('필터 초기화'·마지막 조건 해제)는 바로 저장 — 다음 진입에 이전 조건이 되살아나지 않게.
 *   화면을 떠날 때 남은 저장은 바로 보낸다. 정규화·권한 확인·2KB 한도는 서버 액션이 한다.
 * - 빈 상태 먼저 저장(§6): 파라미터 없는 요청은 같은 화면 안이라도 저장 상태로 복원되므로, 마운트 동안 이 경로의 '빈 상태 저장'을
 *   등록한다(registerEmptyViewSave). 화면 안 이동(navigateView·ViewStateLink)이 빈 쿼리로 갈 때 이 저장(대기 중 디바운스 취소 + '')을
 *   기다린 뒤 이동한다 — 그래서 이동 요청은 redirect 되지 않고, 이동 후 빈 쿼리는 이미 저장됐으니 다시 보내지 않는다.
 * - 스크롤: 진행 중 스크롤은 위치만 기억하고, 화면 이탈·탭 숨김(visibilitychange) 때 {query, top} 을 1회 저장한다.
 *   첫 마운트(데이터가 렌더된 뒤 다음 프레임)에 restoreTop 이 있으면 그 위치로(높이가 모자라면 브라우저가 최대로 맞춘다), 없으면 맨 위.
 *   필터·정렬·페이지가 바뀌면 맨 위로.
 */
export function ViewStateTracker({ pageKey, savedQuery, restoreTop }: ViewStateTrackerProps) {
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? '';

  const queryRef = useRef(query);
  const initialQueryRef = useRef(query);
  // 저장 행이 없으면 빈 상태와 같다 — 첫 방문의 빈 쿼리는 저장하지 않는다
  const lastSavedRef = useRef<string>(savedQuery ?? '');
  const pendingRef = useRef<{ query: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const topRef = useRef(0);
  const lastScrollRef = useRef<string | null>(null);
  const restoreTopRef = useRef(restoreTop);

  // ── 쿼리 저장 (디바운스) ─────────────────────────────────────────────────
  useEffect(() => {
    queryRef.current = query;
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    }
    if (query !== initialQueryRef.current) {
      // 조건이 바뀌었다 → 맨 위로 (§2.3-3). 첫 렌더(복원·진입)는 아래 스크롤 복원이 정한다
      initialQueryRef.current = query;
      const main = mainElement();
      if (main) main.scrollTop = 0;
      topRef.current = 0;
    }
    if (query === lastSavedRef.current) return;
    const send = (value: string) => {
      pendingRef.current = null;
      lastSavedRef.current = value;
      void saveViewStateAction({ pageKey, query: value }).catch(() => undefined);
    };
    if (query === '') {
      send(query);
      return;
    }
    pendingRef.current = { query, timer: setTimeout(() => send(query), VIEW_SAVE_DEBOUNCE_MS) };
  }, [pageKey, query]);

  // 최신 복원 위치 (같은 화면 안 RSC 갱신으로 바뀐 값은 다음 진입(마운트·Activity 재표시)에만 쓴다)
  useEffect(() => {
    restoreTopRef.current = restoreTop;
  }, [restoreTop]);

  // ── 스크롤 추적·복원·이탈 저장 ──────────────────────────────────────────
  // 진입(마운트, 또는 라우터가 숨겨 둔 화면을 다시 보일 때)마다 1회 실행된다
  useEffect(() => {
    const main = mainElement();
    initialQueryRef.current = queryRef.current;
    const path = PAGE_PATHS[pageKey];
    const unregisterEmptySave = registerEmptyViewSave(path, async () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
      lastSavedRef.current = '';
      await saveViewStateAction({ pageKey, query: '' });
    });
    const flushQuery = () => {
      const pending = pendingRef.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRef.current = null;
      lastSavedRef.current = pending.query;
      void saveViewStateAction({ pageKey, query: pending.query }).catch(() => undefined);
    };
    const saveScroll = () => {
      const top = Math.max(0, Math.round(topRef.current));
      const key = `${queryRef.current}#${top}`;
      if (key === lastScrollRef.current) return;
      lastScrollRef.current = key;
      void saveViewScrollAction({ pageKey, query: queryRef.current, top }).catch(() => undefined);
    };
    const onScroll = () => {
      // 다른 화면으로 이동이 커밋된 뒤의 스크롤(새 화면 맨 위)은 이 화면 위치가 아니다
      if (main && window.location.pathname === path) topRef.current = main.scrollTop;
    };
    const onLeave = () => {
      flushQuery();
      saveScroll();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onLeave();
    };

    let frame = 0;
    if (main) {
      topRef.current = main.scrollTop;
      main.addEventListener('scroll', onScroll, { passive: true });
      // 데이터 렌더(하이드레이션) 뒤 다음 프레임에 1회 (프레임 전에 정리되면 — StrictMode 이중 마운트 — 다음 실행이 다시 시도)
      frame = requestAnimationFrame(() => {
        main.scrollTop = restoreTopRef.current ?? 0;
        topRef.current = main.scrollTop;
      });
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onLeave);
    return () => {
      unregisterEmptySave();
      cancelAnimationFrame(frame);
      main?.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onLeave);
      // 화면 이탈: 남은 쿼리 저장 + 스크롤 1회 저장
      onLeave();
    };
  }, [pageKey]);

  return null;
}
