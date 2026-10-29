'use client';

import { m } from 'motion/react';

import { spring } from '@/lib/motion/tokens';

/**
 * 제품군 탭 활성 밑줄 (Motion 도입 스펙 §3.3 `FamilyTabs` 밑줄 인디케이터, P3). 탭 링크·데이터는 RSC(`FamilyTabs`)에 두고
 * 밑줄만 client 로 분리해 `layoutId` + `spring.layout` 으로 활성 탭 사이를 미끄러진다. 활성 탭 안에만 렌더한다.
 * 기존 `border-b-2` 밑줄 자리(링크 아래쪽 2px 테두리 영역)에 그대로 겹쳐 외형은 같다. 숨김 initial 없음(§3.4-1).
 */
export function FamilyTabIndicator({ layoutId }: { layoutId: string }) {
  return (
    <m.span
      aria-hidden="true"
      data-family-tab-indicator=""
      layoutId={layoutId}
      transition={spring.layout}
      className="pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 bg-neutral-900"
    />
  );
}
