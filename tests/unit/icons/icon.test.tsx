import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DisclosureIcon, Icon, type IconProps } from '@/components/icons/Icon';
import { PENTA_ICONS } from '@/components/icons/penta';

/** 디자인 PR-3 — Icon(20·24, aria) */
const svgOf = (props: IconProps) => render(<Icon {...props} />).container.querySelector('svg')!;

describe('Icon', () => {
  it('기본은 장식 — aria-hidden·focusable=false, role·title 없음, 20px', () => {
    const svg = svgOf({ name: 'search' });
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).not.toHaveAttribute('role');
    expect(svg.querySelector('title')).toBeNull();
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg).toHaveAttribute('data-icon', 'search');
  });

  it('title 을 주면 role="img" + <title> + 접근 이름, aria-hidden 없음', () => {
    const { getByRole } = render(<Icon name="warning" title="경고" />);
    const svg = getByRole('img', { name: '경고' });
    expect(svg).not.toHaveAttribute('aria-hidden');
    expect(svg.querySelector('title')).toHaveTextContent('경고');
  });

  it('size 는 20·24 — 24 를 주면 24px', () => {
    const svg = svgOf({ name: 'home', size: 24 });
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
    // @ts-expect-error — 20·24 외 크기는 타입에서 막는다(16px 이하 금지)
    const bad: IconProps = { name: 'home', size: 16 };
    expect(bad).toBeDefined();
  });

  it('색은 currentColor 만, 원본 선 두께(1px) — strokeWidth 덮어쓰기 없음, className 은 합쳐서 shrink-0 유지', () => {
    const svg = svgOf({ name: 'close', className: 'text-primary-700' });
    expect(svg).toHaveClass('shrink-0', 'text-primary-700');
    const painted = [...svg.querySelectorAll('[stroke],[fill]')].flatMap((el) =>
      ['stroke', 'fill'].map((key) => el.getAttribute(key)).filter((v) => v !== null),
    );
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.every((v) => v === 'currentColor' || v === 'none')).toBe(true);
    expect(svg.querySelector('[stroke-width]')).toBeNull();
  });

  it('생성 맵의 모든 아이콘이 그려진다', () => {
    for (const name of Object.keys(PENTA_ICONS) as (keyof typeof PENTA_ICONS)[]) {
      const svg = svgOf({ name });
      expect(svg.querySelectorAll('path').length, name).toBeGreaterThan(0);
    }
  });

  it('DisclosureIcon = chevron-right 90°(펼치기)·-90°(접기)', () => {
    const closed = render(<DisclosureIcon open={false} />).container.querySelector('svg')!;
    expect(closed).toHaveAttribute('data-icon', 'chevron-right');
    expect(closed).toHaveClass('rotate-90');
    const open = render(<DisclosureIcon open />).container.querySelector('svg')!;
    expect(open).toHaveClass('-rotate-90');
    expect(open).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('dangerouslySetInnerHTML 미사용 (PR-3 수용 기준)', () => {
  it('src 전체에서 0건 — 아이콘은 JSX 요소로만 그린다', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    let out = '';
    try {
      out = execFileSync('grep', ['-rl', 'dangerouslySetInnerHTML', 'src'], {
        cwd: root,
        encoding: 'utf8',
      });
    } catch (error) {
      // grep: 일치 없음 = 종료 코드 1
      if ((error as { status?: number }).status !== 1) throw error;
    }
    expect(out.trim()).toBe('');
  });
});
