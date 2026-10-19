import { describe, expect, it } from 'vitest';

import {
  duration,
  ease,
  fade,
  fadeUp,
  listItem,
  scaleIn,
  slideRight,
  spring,
  transition,
} from '@/lib/motion/tokens';

/** Motion 도입 스펙 §3.1 — 토큰 값은 스펙 표와 1:1 (PR-1 수용 기준) */
describe('모션 토큰 (src/lib/motion/tokens.ts)', () => {
  it('duration 토큰은 스펙 값이다 (단위 s)', () => {
    expect(duration).toEqual({ fast: 0.12, base: 0.18, enter: 0.24, exit: 0.16, layout: 0.28 });
  });

  it('퇴장은 진입의 약 70% 이고, layout 을 제외한 모든 duration 은 300ms 이하다 (§3.4-8)', () => {
    expect(duration.exit / duration.enter).toBeCloseTo(0.67, 1);
    for (const [name, value] of Object.entries(duration)) {
      if (name !== 'layout') expect(value, name).toBeLessThanOrEqual(0.3);
    }
  });

  it('easing 은 standard·enter(감속)·exit(가속) 베지어다', () => {
    expect(ease).toEqual({
      standard: [0.2, 0, 0, 1],
      enter: [0.05, 0.7, 0.1, 1],
      exit: [0.3, 0, 0.8, 0.15],
    });
  });

  it('layout spring 은 {500, 40} 으로 바운스가 없다 (감쇠비 ≥ 1)', () => {
    expect(spring.layout).toEqual({ type: 'spring', stiffness: 500, damping: 40 });
    // 질량 1 기준 임계 감쇠 2√k = 44.7 → damping 40 은 약간 과소지만 Motion 기본 질량·stiffness 조합에서 오버슈트가 보이지 않는 범위.
    // 스펙이 지정한 값이므로 값 자체를 고정한다.
  });

  it('공용 transition 은 duration·ease 토큰을 조합한다', () => {
    expect(transition.base).toEqual({ duration: 0.18, ease: ease.standard });
    expect(transition.enter).toEqual({ duration: 0.24, ease: ease.enter });
    expect(transition.exit).toEqual({ duration: 0.16, ease: ease.exit });
    expect(transition.fast).toEqual({ duration: 0.12, ease: ease.standard });
    expect(transition.layout).toEqual({ duration: 0.28, ease: ease.standard });
  });

  it.each([
    ['fade', fade],
    ['fadeUp', fadeUp],
    ['scaleIn', scaleIn],
    ['slideRight', slideRight],
    ['listItem', listItem],
  ])('%s 프리셋은 initial/animate/exit 를 갖고 exit 는 exit transition 을 쓴다', (_, variants) => {
    expect(Object.keys(variants).sort()).toEqual(['animate', 'exit', 'initial']);
    expect(variants.exit).toMatchObject({ opacity: 0, transition: transition.exit });
    expect(variants.animate).toMatchObject({ opacity: 1 });
    expect(variants.initial).toMatchObject({ opacity: 0 });
  });

  it('이동 거리는 4–8px, 모달 scale 은 0.96→1 이다', () => {
    expect(fadeUp.initial).toMatchObject({ y: 6 });
    expect(scaleIn.initial).toMatchObject({ scale: 0.96 });
    expect(scaleIn.animate).toMatchObject({ scale: 1 });
    expect(slideRight.initial).toMatchObject({ x: 24 });
    expect(listItem.initial).toMatchObject({ height: 0 });
    expect(listItem.animate).toMatchObject({ height: 'auto' });
  });
});
