'use client';

import { m, type HTMLMotionProps } from 'motion/react';

import { cn } from '@/lib/cn';
import { VARIANT_KEYS, listItem } from '@/lib/motion/tokens';

export type CollapseProps = HTMLMotionProps<'div'>;

/**
 * 인라인 성공·에러 배너와 폼 에러 전용 펼침/접힘 래퍼 (Motion 도입 스펙 §3.3 인라인 피드백).
 * `Presence` 안에서 조건부로 마운트하면 `listItem` 프리셋(height 0↔auto + fade, base/exit)으로 펼쳐지고 접힌다.
 * `role`·`aria-live` 는 이 요소(m.div)에 그대로 둔다. 배경·패딩은 자식에 두어야 접히는 동안 패딩만 남지 않는다.
 * 서버가 처음부터 렌더하는 상시 배너에는 쓰지 않는다 — 사용자 조작 결과로 나타났다 사라지는 것만.
 */
export function Collapse({ className, children, ...rest }: CollapseProps) {
  return (
    <m.div
      variants={listItem}
      initial={VARIANT_KEYS.initial}
      animate={VARIANT_KEYS.animate}
      exit={VARIANT_KEYS.exit}
      className={cn('overflow-hidden', className)}
      {...rest}
    >
      {children}
    </m.div>
  );
}
