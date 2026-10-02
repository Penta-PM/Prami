import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Collapse } from '@/components/motion/Collapse';
import { Presence } from '@/components/motion/Presence';
import { Segmented } from '@/components/ui';
import { Sidebar } from '@/features/shell/Sidebar';

/**
 * Motion 도입 PR-3 전환·피드백 (스펙 §3.3 P2). tests/setup.ts 가 skipAnimations=true 를 깔아 두므로
 * 퇴장 중인 요소는 즉시(다음 틱) 제거된다 — 사라짐은 waitFor 로 단언한다.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

// CalculatorTabs 는 탭 전환 모션만 본다 — 무거운 계산기 본체는 상호작용 가능한 가벼운 스텁으로 대체
vi.mock('@/features/calculator/QuoteCalculator', () => ({
  QuoteCalculator: () => (
    <section aria-label="견적 계산기 본문">
      <button type="button">견적 버튼</button>
    </section>
  ),
}));
vi.mock('@/features/calculator/MarginCalculator', () => ({
  MarginCalculator: () => (
    <section aria-label="순매출 계산기 본문">
      <input aria-label="판매가 스텁" />
    </section>
  ),
}));
const { CalculatorTabs } = await import('@/features/calculator/CalculatorTabs');

const OPTIONS = [
  { value: 'a', label: 'A 탭' },
  { value: 'b', label: 'B 탭' },
  { value: 'c', label: 'C 탭' },
] as const;

function SegmentedHarness({ initial = 'a' }: { initial?: 'a' | 'b' | 'c' }) {
  const [value, setValue] = useState<'a' | 'b' | 'c'>(initial);
  return <Segmented aria-label="하네스" options={OPTIONS} value={value} onChange={setValue} />;
}

const pills = (root: HTMLElement) => root.querySelectorAll('[data-segmented-pill]');

describe('Segmented 활성 pill (§3.3 세그먼트 탭 — layoutId)', () => {
  it('활성 항목 안에만 pill 이 하나 렌더되고, 전환하면 새 활성 항목으로 따라간다', async () => {
    const { container } = render(<SegmentedHarness />);
    const group = screen.getByRole('radiogroup', { name: '하네스' });

    expect(pills(container)).toHaveLength(1);
    expect(
      screen.getByRole('radio', { name: 'A 탭' }).querySelector('[data-segmented-pill]'),
    ).not.toBeNull();
    expect(
      screen.getByRole('radio', { name: 'B 탭' }).querySelector('[data-segmented-pill]'),
    ).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: 'B 탭' }));

    expect(pills(container)).toHaveLength(1);
    expect(
      screen.getByRole('radio', { name: 'B 탭' }).querySelector('[data-segmented-pill]'),
    ).not.toBeNull();
    expect(
      screen.getByRole('radio', { name: 'A 탭' }).querySelector('[data-segmented-pill]'),
    ).toBeNull();
    // 라디오 그룹 시맨틱은 그대로
    expect(screen.getByRole('radio', { name: 'B 탭' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'A 탭' })).toHaveAttribute('aria-checked', 'false');
    expect(group).toBeInTheDocument();
  });

  it('pill 은 장식(aria-hidden)이라 라디오 접근 가능 이름을 바꾸지 않는다', () => {
    render(<SegmentedHarness initial="c" />);
    const active = screen.getByRole('radio', { name: 'C 탭' });
    expect(active.querySelector('[data-segmented-pill]')).toHaveAttribute('aria-hidden', 'true');
    expect(active).toHaveAccessibleName('C 탭');
  });

  it('Segmented 가 여럿이어도 각 인스턴스의 pill 은 하나씩이다 (layoutId 고유)', () => {
    const { container } = render(
      <>
        <SegmentedHarness initial="a" />
        <SegmentedHarness initial="b" />
      </>,
    );
    expect(pills(container)).toHaveLength(2);
  });
});

describe('CalculatorTabs 탭 전환 (§3.3 — 퇴장 없음, mode="wait" 금지)', () => {
  it('탭을 바꾸면 새 콘텐츠가 즉시 DOM 에 있고 바로 상호작용할 수 있다', async () => {
    render(<CalculatorTabs preload={[]} savedQuotes={[]} canSeeCost />);
    expect(screen.getByRole('region', { name: '견적 계산기 본문' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '순매출 계산기 본문' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: '순매출 계산기' }));

    // 클릭 직후 동기 단언 — 이전 콘텐츠의 퇴장을 기다리지 않는다
    const next = screen.getByRole('region', { name: '순매출 계산기 본문' });
    expect(next).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '견적 계산기 본문' })).not.toBeInTheDocument();
    await userEvent.type(within(next).getByRole('textbox', { name: '판매가 스텁' }), '1200');
    expect(within(next).getByRole('textbox', { name: '판매가 스텁' })).toHaveValue('1200');

    await userEvent.click(screen.getByRole('radio', { name: '견적 계산기' }));
    expect(screen.getByRole('region', { name: '견적 계산기 본문' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '순매출 계산기 본문' })).not.toBeInTheDocument();
  });

  it('initialTab 으로 시작한 첫 렌더 콘텐츠는 숨김 initial 없이 바로 보인다 (서버 렌더 보호)', () => {
    render(<CalculatorTabs preload={[]} savedQuotes={[]} canSeeCost initialTab="margin" />);
    const region = screen.getByRole('region', { name: '순매출 계산기 본문' });
    const wrapper = region.parentElement as HTMLElement;
    // 첫 렌더에는 opacity:0 / y 이동 인라인 스타일이 붙지 않는다 (정지 상태는 '' 또는 'none')
    expect(wrapper.style.opacity).not.toBe('0');
    expect(['', 'none']).toContain(wrapper.style.transform);
  });
});

function BannerHarness() {
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setFlash('저장했습니다')}>
        저장
      </button>
      <button type="button" onClick={() => setFlash(null)}>
        닫기
      </button>
      <Presence>
        {flash ? (
          <Collapse key="flash" role="status" aria-live="polite">
            <p className="m-0 px-3 py-2">{flash}</p>
          </Collapse>
        ) : null}
      </Presence>
    </>
  );
}

describe('인라인 배너 Presence + Collapse(listItem) (§3.3 인라인 피드백)', () => {
  it('나타날 때 role·aria-live 를 m.div 에 그대로 가지고, 사라질 때 DOM 에서 제거된다', async () => {
    render(<BannerHarness />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner).toHaveTextContent('저장했습니다');
    expect(banner).toHaveClass('overflow-hidden');

    await userEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('role="alert" 도 동일하게 유지된다', async () => {
    const { rerender } = render(
      <Presence>
        <Collapse key="err" role="alert">
          <p>잘못된 값</p>
        </Collapse>
      </Presence>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('잘못된 값');
    rerender(<Presence>{null}</Presence>);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('Sidebar 라벨 fade (§3.3 사이드바 — 폭·translate 는 CSS 유지)', () => {
  it('접으면 라벨과 "관리자" 헤더가 제거되고 펼치면 돌아온다', async () => {
    render(<Sidebar showAdminNav />);
    const toggle = screen.getByRole('button', { name: '사이드바 접기/펼치기' });
    const aside = screen.getByRole('complementary', { name: '주 메뉴' });
    expect(screen.getByText('가격 정책 조회')).toBeInTheDocument();
    expect(within(aside).getByText('관리자')).toBeInTheDocument();
    // 폭 전환은 CSS transition 그대로 (E2E 가 boundingBox 250→72 를 단언)
    expect(aside.className).toContain('transition-[width,transform]');
    expect(aside.className).toContain('duration-200');

    await userEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText('가격 정책 조회')).not.toBeInTheDocument());
    await waitFor(() => expect(within(aside).queryByText('관리자')).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: '가격 정책 조회' })).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByText('가격 정책 조회')).toBeInTheDocument();
    expect(within(aside).getByText('관리자')).toBeInTheDocument();
  });
});
