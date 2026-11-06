'use client';

import type { Variants } from 'motion/react';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { transition } from '@/lib/motion/tokens';

/**
 * 하단 시트 (모바일 UI 스펙 §3 BottomSheet·§5 M0). 경계는 Tailwind `md`(768px) — 모바일 스타일은 `max-md:` 에만 두고
 * 데스크톱 경로는 바꾸지 않는다. 표시(위치·높이·스크롤)는 전부 CSS 이고, JS 분기는 모션(아래에서 위로)과 배경 잠금뿐이다.
 */
export const SHEET_MEDIA_QUERY = '(width < 48rem)';

const noopUnsubscribe = () => {};

/**
 * 지금 시트로 그려지는지 — 모션 분기 전용(스펙 §3 "JS 허용 두 곳" ②). 열려 있을 때만 matchMedia 를 구독하고,
 * 서버 스냅샷은 데스크톱(false)이라 하이드레이션 불일치가 없다. 렌더 구조를 이것으로 바꾸지 않는다(표시는 CSS).
 */
export function useSheetLayout(active: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active || typeof window.matchMedia !== 'function') return noopUnsubscribe;
      const query = window.matchMedia(SHEET_MEDIA_QUERY);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    [active],
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      active &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(SHEET_MEDIA_QUERY).matches,
    () => false,
  );
}

/** 시트 패널 — 아래에서 위로(y 100%→0). duration·ease 는 다른 패널과 같은 enter/exit 토큰, 모션 감소는 MotionProvider 가 따른다 */
export const sheetUp: Variants = {
  initial: { y: '100%' },
  animate: { y: 0, transition: transition.enter },
  exit: { y: '100%', transition: transition.exit },
};

let scrollLocks = 0;

/**
 * 배경 스크롤 잠금 — 시트·사이드바 오버레이가 열려 있는 동안 `<html data-scroll-lock>` 를 단다. 실제 잠금은 globals.css 가
 * `max-md` 에서만 건다(본문 #app-main 이 자체 스크롤이라 그것까지). 데스크톱은 스크롤바가 사라지는 레이아웃 변화를 피하려고 걸지 않는다.
 * 여러 겹(드로어 안 모달 등)은 개수로 센다.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    scrollLocks += 1;
    document.documentElement.setAttribute('data-scroll-lock', '');
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) document.documentElement.removeAttribute('data-scroll-lock');
    };
  }, [active]);
}
