'use client';

import { LazyMotion, MotionConfig, MotionGlobalConfig, domMax } from 'motion/react';
import type { ReactNode } from 'react';

import { transition } from '@/lib/motion/tokens';

/**
 * 모션 비활성 플래그 (E2E 전용, Motion 도입 스펙 §3.2). `NEXT_PUBLIC_*` 는 빌드 시점에 인라인되므로
 * 모듈 평가 시 한 번 읽는다. 켜지면 모든 Motion 애니메이션을 건너뛰어 요소가 즉시 최종 상태가 된다.
 */
export const MOTION_DISABLED = process.env.NEXT_PUBLIC_MOTION_DISABLED === '1';

// 자식 컴포넌트가 마운트되기 전에 전역 설정을 끝내야 하므로 렌더가 아니라 모듈 평가 시점에 적용한다
if (MOTION_DISABLED) MotionGlobalConfig.skipAnimations = true;

/**
 * 루트 Provider (`src/app/layout.tsx` <body> 바로 안쪽). LazyMotion strict + domMax 라
 * 클라이언트 파일은 `motion/react` 의 `m.*` 만 쓴다 (`motion.*` 혼용 시 런타임 에러).
 * `nonce` 는 넘기지 않는다 — style-src 에 nonce 가 들어가면 'unsafe-inline' 이 무효화된다 (CSP 변경 금지).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig
        reducedMotion={MOTION_DISABLED ? 'always' : 'user'}
        transition={transition.base}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
