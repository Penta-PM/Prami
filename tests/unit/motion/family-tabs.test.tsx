import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MotionProvider } from '@/components/motion/MotionProvider';
import { FamilyTabs } from '@/features/parts/FamilyTabs';

/**
 * FamilyTabs 밑줄 인디케이터 (Motion 도입 스펙 §3.3, P3): 활성 탭 링크 안에만 1개, 서버 렌더 첫 화면에서 숨김 initial 없음.
 * 탭이 바뀌면 인디케이터는 새 활성 탭으로 옮겨 간다(layoutId 공유).
 */
function renderTabs(active: string) {
  return render(
    <FamilyTabs families={['WAPPLES', 'D.AMO', 'iSIGN']} active={active} basePath="/admin/parts" />,
    { wrapper: MotionProvider },
  );
}

const indicators = () => document.querySelectorAll<HTMLElement>('[data-family-tab-indicator]');

describe('FamilyTabs 인디케이터 (Motion 도입 스펙 §3.3)', () => {
  it('활성 탭 안에만 1개 렌더하고 숨김 스타일이 없다', () => {
    renderTabs('D.AMO');
    const nav = screen.getByRole('navigation', { name: '제품군' });
    const active = within(nav).getByRole('link', { current: 'page' });
    expect(indicators()).toHaveLength(1);
    expect(active).toContainElement(indicators()[0]!);
    expect(indicators()[0]).toHaveAttribute('aria-hidden', 'true');
    const { opacity, transform } = indicators()[0]!.style;
    expect(opacity === '' || opacity === '1').toBe(true);
    expect(transform === '' || transform === 'none').toBe(true);
  });

  it('활성 탭이 바뀌면 인디케이터가 새 활성 탭으로 옮겨 가고 여전히 1개다', () => {
    const { rerender } = renderTabs('WAPPLES');
    rerender(
      <FamilyTabs
        families={['WAPPLES', 'D.AMO', 'iSIGN']}
        active="iSIGN"
        basePath="/admin/parts"
      />,
    );
    expect(indicators()).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'iSIGN' })).toContainElement(indicators()[0]!);
  });
});
