import type { Transition, Variants } from 'motion/react';

/**
 * 모션 토큰 (Motion 도입 스펙 §3.1). 순수 TS 모듈 — CSS 변수로 두지 않는다
 * (tests/unit/tokens.test.ts 가 globals.css 의 CSS 토큰 개수를 검사한다).
 *
 * 규칙: 이동 거리 4–8px, 모달 scale 0.96→1, 퇴장은 진입의 약 70%, 바운스 있는 spring 금지, 300ms 초과 금지(layout 제외).
 */
export const duration = {
  /** press, 라벨 fade, 색 */
  fast: 0.12,
  /** fade, 배너, 탭 콘텐츠, 챗 버블 */
  base: 0.18,
  /** 모달·드로어·챗 패널 진입 */
  enter: 0.24,
  /** 모든 퇴장 */
  exit: 0.16,
  /** 목록 재배치 */
  layout: 0.28,
} as const;

type CubicBezier = [number, number, number, number];

export const ease: Record<'standard' | 'enter' | 'exit', CubicBezier> = {
  standard: [0.2, 0, 0, 1],
  /** 진입(감속) */
  enter: [0.05, 0.7, 0.1, 1],
  /** 퇴장(가속) */
  exit: [0.3, 0, 0.8, 0.15],
};

export const spring = {
  /** layout·layoutId 인디케이터 — 바운스 없음 */
  layout: { type: 'spring', stiffness: 500, damping: 40 } satisfies Transition,
} as const;

/** 토큰을 조합한 공용 transition. MotionConfig 기본값은 `transition.base` */
export const transition = {
  fast: { duration: duration.fast, ease: ease.standard } satisfies Transition,
  base: { duration: duration.base, ease: ease.standard } satisfies Transition,
  enter: { duration: duration.enter, ease: ease.enter } satisfies Transition,
  exit: { duration: duration.exit, ease: ease.exit } satisfies Transition,
  layout: { duration: duration.layout, ease: ease.standard } satisfies Transition,
} as const;

/** variants 공용 키 — `initial="initial" animate="animate" exit="exit"` 로 사용한다 */
export const VARIANT_KEYS = { initial: 'initial', animate: 'animate', exit: 'exit' } as const;

export const fade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: transition.base },
  exit: { opacity: 0, transition: transition.exit },
};

/** 아래에서 6px 올라오며 나타남 — 탭 콘텐츠, 챗 버블 */
export const fadeUp: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: transition.base },
  exit: { opacity: 0, y: 6, transition: transition.exit },
};

/** 모달 패널 — 0.96→1 + fade */
export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: transition.enter },
  exit: { opacity: 0, scale: 0.96, transition: transition.exit },
};

/** 오른쪽에서 24px 들어오며 나타남 — 드로어, 챗 패널 */
export const slideRight: Variants = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0, transition: transition.enter },
  exit: { opacity: 0, x: 24, transition: transition.exit },
};

/** 목록 항목 — height 0↔auto + fade. 삭제 항목은 접히며 사라진다 */
export const listItem: Variants = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto', transition: transition.base },
  exit: { opacity: 0, height: 0, transition: transition.exit },
};
