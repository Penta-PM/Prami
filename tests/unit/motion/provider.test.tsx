import { render, screen } from '@testing-library/react';
import { MotionGlobalConfig, m } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Presence } from '@/components/motion/Presence';

/**
 * Motion 도입 스펙 §3.2 — MotionProvider 는 NEXT_PUBLIC_MOTION_DISABLED=1 일 때 전역 skipAnimations 를 켠다.
 * 플래그는 모듈 평가 시 읽으므로 테스트마다 모듈 레지스트리를 비우고 다시 import 한다.
 * tests/setup.ts 가 skipAnimations=true 를 깔아 두므로 검사 전에 false 로 되돌린다.
 */
async function loadProvider() {
  vi.resetModules();
  return import('@/components/motion/MotionProvider');
}

describe('MotionProvider', () => {
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = false;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    MotionGlobalConfig.skipAnimations = true;
  });

  it('플래그가 없으면 skipAnimations 를 건드리지 않고 reducedMotion="user" 로 동작한다', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOTION_DISABLED', '');
    const { MotionProvider, MOTION_DISABLED } = await loadProvider();

    expect(MOTION_DISABLED).toBe(false);
    expect(MotionGlobalConfig.skipAnimations).toBe(false);

    render(
      <MotionProvider>
        <m.div data-testid="child" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          내용
        </m.div>
      </MotionProvider>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('내용');
  });

  it('NEXT_PUBLIC_MOTION_DISABLED=1 이면 모듈 평가 시 skipAnimations 를 켠다 (E2E 전용 플래그)', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOTION_DISABLED', '1');
    const { MOTION_DISABLED } = await loadProvider();

    expect(MOTION_DISABLED).toBe(true);
    expect(MotionGlobalConfig.skipAnimations).toBe(true);
  });

  it('LazyMotion strict 안에서 m.* 가 렌더된다 (motion.* 혼용 금지 규칙의 전제)', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOTION_DISABLED', '');
    const { MotionProvider } = await loadProvider();
    const { container } = render(
      <MotionProvider>
        <m.button type="button" whileTap={{ scale: 0.98 }}>
          누르기
        </m.button>
      </MotionProvider>,
    );
    expect(container.querySelector('button')).toHaveTextContent('누르기');
  });
});

describe('Presence', () => {
  it('자식을 조건부로 렌더하고 사라지면 (skipAnimations 하에서) 즉시 제거된다', async () => {
    const { rerender } = render(
      <Presence>
        {true ? (
          <m.p key="banner" role="status" exit={{ opacity: 0 }}>
            저장했습니다
          </m.p>
        ) : null}
      </Presence>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(<Presence>{null}</Presence>);
    await vi.waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
