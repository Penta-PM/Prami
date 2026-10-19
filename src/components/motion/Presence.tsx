'use client';

import { AnimatePresence } from 'motion/react';
import type { ReactNode } from 'react';

export type PresenceProps = {
  children: ReactNode;
  /**
   * 기본 `sync`. `wait` 는 이전 요소의 퇴장을 기다리므로 탭 콘텐츠처럼 즉시 상호작용해야 하는 곳에는 쓰지 않는다.
   * `popLayout` 은 <style> 을 주입해 CSP 와 충돌하므로 제공하지 않는다 (스펙 §3.4-5).
   */
  mode?: 'sync' | 'wait';
  /** 퇴장 애니메이션이 모두 끝났을 때 */
  onExitComplete?: () => void;
};

/**
 * `<AnimatePresence initial={false}>` 래퍼 (Motion 도입 스펙 §3.2).
 * 조건부 마운트 `{x ? <X/> : null}` 를 감싸면 언마운트 시 자식의 `exit` variants 가 재생된다.
 * `initial={false}` 라 처음 마운트(페이지 로드·패널 재오픈 시 기존 항목)는 애니메이션하지 않는다.
 */
export function Presence({ children, mode = 'sync', onExitComplete }: PresenceProps) {
  return (
    <AnimatePresence initial={false} mode={mode} onExitComplete={onExitComplete}>
      {children}
    </AnimatePresence>
  );
}
