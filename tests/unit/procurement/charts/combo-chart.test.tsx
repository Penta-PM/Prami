import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComboChart, type ComboSeries } from '@/features/procurement/charts';

/**
 * 조달이 통합 UI-4 — 월별(막대)+누적(선) 2축 콤보 차트. 합성 계열(가짜 회사명)만.
 * 접근성: role="img"+요약, 펼침 요약, 표로 보기(같은 데이터), 키보드 월 이동·툴팁(aria-live), 범례 강조·숨김, 자사 --accent-ours.
 */
const MONTHS = ['2025-01', '2025-02', '2025-03', '2025-04'];
const M = 1_000_000;
const SERIES: ComboSeries[] = [
  { key: 'alpha', name: '알파테크 주식회사', values: [100 * M, 0, 300 * M, 50 * M] },
  { key: 'ours', name: '합성자사(주)', isOurs: true, values: [50 * M, 50 * M, 0, 120 * M] },
  { key: 'beta', name: '베타소프트', values: [0, 20 * M, 10 * M, 0] },
  { key: 'gamma', name: '감마시스템', values: [5 * M, 0, 0, 0] },
  { key: 'delta', name: '델타보안', values: [1 * M, 1 * M, 1 * M, 1 * M] },
  { key: 'eps', name: '엡실론', values: [2 * M, 0, 0, 0] },
];

const svg = () => screen.getByRole('img');
const plot = () => screen.getByRole('group', { name: /./ });
const live = () => document.querySelector('[data-chart-live]')!;
const tooltip = () => screen.queryByRole('tooltip');

describe('ComboChart — 렌더링', () => {
  it('svg role="img" + 요약 문장(aria-label), 펼침 요약에 같은 문장', () => {
    render(<ComboChart title="월별 매출 추이" months={MONTHS} series={SERIES} />);
    const label = svg().getAttribute('aria-label')!;
    expect(label).toMatch(/^월별 매출 추이\. 2025년 1월~2025년 4월 4개월, 합계 /);
    expect(label).toContain('자사(합성자사) 누적 2억 2,000만');
    expect(document.querySelector('[data-chart-summary]')).toHaveTextContent(label);
    expect(screen.getByText('차트 요약').closest('details')).not.toBeNull();
  });

  it('쌓은 막대 — 0 이 아닌 (계열, 월)마다 하나, 자사 막대가 맨 아래', () => {
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    const bars = document.querySelectorAll('[data-bar]');
    const expected = SERIES.flatMap((item) => item.values.filter((value) => value > 0)).length;
    expect(bars).toHaveLength(expected);
    const jan = [...document.querySelectorAll<SVGRectElement>('[data-bar$=":2025-01"]')];
    // 첫 막대(맨 아래 = y 가 가장 큼) = 자사
    const bottom = jan.reduce((a, b) =>
      Number(a.getAttribute('y')) > Number(b.getAttribute('y')) ? a : b,
    );
    expect(bottom.getAttribute('data-bar')).toBe('ours:2025-01');
    expect(bottom.getAttribute('stroke')).toBe('var(--accent-ours)');
  });

  it('계열마다 누적선 1개 — 자사 선은 맨 위(마지막)·3px, 점 표식은 계열마다 모양이 다르다', () => {
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    const lines = [...document.querySelectorAll('[data-line]')];
    expect(lines).toHaveLength(SERIES.length);
    expect(lines.at(-1)!.getAttribute('data-line')).toBe('ours');
    const oursPath = lines.at(-1)!.querySelectorAll('path')[1]!;
    expect(oursPath.getAttribute('stroke')).toBe('var(--accent-ours)');
    expect(oursPath.getAttribute('stroke-width')).toBe('3');
    const shapes = lines.map((line) =>
      line.querySelector('[data-marker]')!.getAttribute('data-marker'),
    );
    expect(new Set(shapes).size).toBe(SERIES.length);
  });

  it('축 라벨은 억·만 (D-3), 월이 없으면 안내 문구', () => {
    const { unmount } = render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    expect(svg()).toHaveTextContent('월별(막대)');
    expect(svg()).toHaveTextContent('누적(선)');
    expect(svg().textContent).toMatch(/\d억/);
    unmount();
    render(<ComboChart title="t" months={[]} series={[]} />);
    expect(screen.getByText('표시할 데이터가 없습니다')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('ComboChart — 범례', () => {
  it('자사 항목은 "자사" 글자 + accent-ours, 4개 넘으면 "+N개사"로 접는다', async () => {
    const user = userEvent.setup();
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    const legend = screen.getByRole('list', { name: 't 범례' });
    expect(within(legend).getAllByRole('listitem')).toHaveLength(4);
    const ours = within(legend).getByRole('button', { name: /^합성자사\s?자사$/ });
    expect(ours).toHaveTextContent('자사');
    expect(ours).toHaveClass('text-accent-ours');
    await user.click(screen.getByRole('button', { name: '+2개사' }));
    expect(within(legend).getAllByRole('listitem')).toHaveLength(6);
  });

  it('이름 버튼 = 강조 토글(aria-pressed) — 다른 계열 흐리게, 다시 누르면 해제', async () => {
    const user = userEvent.setup();
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    const alpha = screen.getByRole('button', { name: '알파테크' });
    await user.click(alpha);
    expect(alpha).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[data-line="beta"]')).toHaveAttribute('opacity', '0.15');
    expect(document.querySelector('[data-line="alpha"]')).toHaveAttribute('opacity', '1');
    await user.click(alpha);
    expect(alpha).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-line="beta"]')).toHaveAttribute('opacity', '1');
  });

  it('강조 제어형 — highlightKey·onHighlightChange (UI-5 표 연동)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComboChart
        title="t"
        months={MONTHS}
        series={SERIES}
        highlightKey="beta"
        onHighlightChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: '베타소프트' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: '알파테크' }));
    expect(onChange).toHaveBeenCalledWith('alpha');
  });

  it('눈 버튼 = 숨김 토글 — 숨긴 계열은 막대·선에서 빠지고 다시 누르면 돌아온다', async () => {
    const user = userEvent.setup();
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    const hide = screen.getByRole('button', { name: '알파테크 숨기기' });
    await user.click(hide);
    expect(screen.getByRole('button', { name: '알파테크 보이기' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(document.querySelector('[data-line="alpha"]')).toBeNull();
    expect(document.querySelector('[data-bar^="alpha:"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: '알파테크 보이기' }));
    expect(document.querySelector('[data-line="alpha"]')).not.toBeNull();
  });
});

describe('ComboChart — 키보드·툴팁', () => {
  it('Tab 으로 들어오면 첫 달 툴팁, ←→ 이동, Home/End, Esc 닫기 — aria-live 로 읽는다', async () => {
    const user = userEvent.setup();
    render(<ComboChart title="월별 매출 추이" months={MONTHS} series={SERIES} />);
    act(() => plot().focus());
    expect(plot()).toHaveFocus();
    expect(tooltip()).toHaveTextContent('2025년 1월');
    expect(document.querySelector('[data-active-month]')).toHaveAttribute(
      'data-active-month',
      '2025-01',
    );
    expect(live()).toHaveTextContent('2025년 1월: 합계 월 1억 5,800만');

    await user.keyboard('{ArrowRight}');
    expect(tooltip()).toHaveTextContent('2025년 2월');
    expect(live()).toHaveTextContent(/^2025년 2월/);
    await user.keyboard('{End}');
    expect(tooltip()).toHaveTextContent('2025년 4월');
    await user.keyboard('{ArrowRight}');
    expect(tooltip()).toHaveTextContent('2025년 4월');
    await user.keyboard('{Home}');
    expect(tooltip()).toHaveTextContent('2025년 1월');
    await user.keyboard('{Escape}');
    expect(tooltip()).toBeNull();
    expect(live()).toHaveTextContent('');
  });

  it('툴팁: 자사 + 누적 상위 경쟁사 3곳, 나머지는 "외 N개사", 합계 — 금액 억·만', () => {
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    act(() => plot().focus());
    fireEvent.keyDown(plot(), { key: 'End' });
    const tip = tooltip()!;
    expect(tip).toHaveTextContent('합성자사');
    expect(tip).toHaveTextContent('알파테크');
    expect(tip).toHaveTextContent('외 2개사');
    expect(tip).toHaveTextContent('합계');
    // 4월 합계 월 = 50+120+1 = 1억 7,100만, 누적 = 전체 합
    expect(tip).toHaveTextContent('1억 7,100만');
  });

  it('Enter·클릭 = 그 달 선택(onSelectMonth), 선택한 달을 다시 고르면 null', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <ComboChart title="t" months={MONTHS} series={SERIES} onSelectMonth={onSelect} />,
    );
    act(() => plot().focus());
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('2025-02');
    rerender(
      <ComboChart
        title="t"
        months={MONTHS}
        series={SERIES}
        onSelectMonth={onSelect}
        selectedMonth="2025-02"
      />,
    );
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenLastCalledWith(null);
    // 클릭: x(px) → 칸 (jsdom 너비 대체값 640, 좌측 여백 78)
    fireEvent.click(plot(), { clientX: 640 - 78 - 5 });
    expect(onSelect).toHaveBeenLastCalledWith('2025-04');
  });

  it('UX PR-U1 §2: 달 선택(onSelectMonth)이 있는 차트만 data-clickable(손가락 커서)', () => {
    const { unmount } = render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    expect(plot()).not.toHaveAttribute('data-clickable');
    unmount();
    render(<ComboChart title="t" months={MONTHS} series={SERIES} onSelectMonth={vi.fn()} />);
    expect(plot()).toHaveAttribute('data-clickable', '');
  });

  it('포인터 이동 → 그 칸 툴팁, 벗어나면 닫힘', () => {
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    fireEvent.pointerMove(plot(), { clientX: 80, pointerType: 'mouse' });
    expect(tooltip()).toHaveTextContent('2025년 1월');
    fireEvent.pointerLeave(plot());
    expect(tooltip()).toBeNull();
  });

  it('포커스 고리(focus-visible outline)와 모션 감소(motion-reduce:transition-none)', () => {
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    expect(plot()).toHaveAttribute('tabindex', '0');
    expect(plot().className).toContain('focus-visible:outline-2');
    for (const element of document.querySelectorAll('[data-line], [data-bar]'))
      expect(element.getAttribute('class')).toContain('motion-reduce:transition-none');
  });
});

describe('ComboChart — 표로 보기', () => {
  function cells(row: HTMLElement) {
    return within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
  }

  it('전환 버튼(aria-pressed) — 표는 차트와 같은 데이터(백만원), 다시 누르면 차트', async () => {
    const user = userEvent.setup();
    render(<ComboChart title="월별 매출 추이" months={MONTHS} series={SERIES} />);
    const toggle = screen.getByRole('button', { name: '표로 보기' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.queryByRole('img')).toBeNull();
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('월별 매출 추이 (단위: 백만원)');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    // 자사 먼저 + 주어진 순서
    expect(headers).toEqual([
      '월',
      '합성자사 (자사)',
      '알파테크',
      '베타소프트',
      '감마시스템',
      '델타보안',
      '엡실론',
      '합계',
      '누적 합계',
    ]);
    const rows = within(table).getAllByRole('row');
    // 머리글 + 4개월 + 합계
    expect(rows).toHaveLength(6);
    const jan = rows[1]!;
    expect(within(jan).getByRole('rowheader')).toHaveTextContent('2025년 1월');
    expect(cells(jan)).toEqual(['50.0', '100.0', '0.0', '5.0', '1.0', '2.0', '158.0', '158.0']);
    expect(cells(rows[2]!)).toEqual(['50.0', '0.0', '20.0', '0.0', '1.0', '0.0', '71.0', '229.0']);
    // 합계 행 = 계열 합
    const total = rows.at(-1)!;
    expect(cells(total).slice(0, 7)).toEqual([
      '220.0',
      '450.0',
      '30.0',
      '5.0',
      '4.0',
      '2.0',
      '711.0',
    ]);
    expect(screen.getByRole('button', { name: '차트로 보기' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: '차트로 보기' }));
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('숨긴 계열도 표에는 그대로 (표 = 전체 데이터)', async () => {
    const user = userEvent.setup();
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    await user.click(screen.getByRole('button', { name: '알파테크 숨기기' }));
    await user.click(screen.getByRole('button', { name: '표로 보기' }));
    expect(screen.getByRole('columnheader', { name: '알파테크' })).toBeInTheDocument();
  });
});

describe('ComboChart — 제어형 선택 달', () => {
  it('selectedMonth 띠 + 표에서도 그 행 표시', async () => {
    function Harness() {
      const [month, setMonth] = useState<string | null>('2025-03');
      return (
        <ComboChart
          title="t"
          months={MONTHS}
          series={SERIES}
          selectedMonth={month}
          onSelectMonth={setMonth}
        />
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    // 포커스는 선택한 달부터
    act(() => plot().focus());
    expect(tooltip()).toHaveTextContent('2025년 3월');
    await user.click(screen.getByRole('button', { name: '표로 보기' }));
    expect(document.querySelector('[data-month-row="2025-03"]')).toHaveAttribute(
      'data-selected',
      'true',
    );
  });
});

describe('ComboChart — 선명한 렌더링', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 잰 너비 흉내 — ResizeObserver 가 있고 상자 너비가 소수(640.4px) */
  function mockWidth(width: number) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 0,
      width,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect);
  }
  const num = (element: Element, name: string) => Number(element.getAttribute(name));

  it('viewBox 너비 = 잰 실수 너비(반올림 없음), 높이는 정수', () => {
    mockWidth(640.4);
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    const [, , w, h] = svg().getAttribute('viewBox')!.split(' ').map(Number);
    expect(w).toBe(640.4);
    expect(Number.isInteger(h)).toBe(true);
    expect(svg()).toHaveAttribute('width', '100%');
  });

  it('가로 격자 y 는 .5 로 끝나고 crispEdges 는 격자에만 (막대·선·표식에는 없음)', () => {
    mockWidth(640.4);
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    const grid = [...document.querySelectorAll('[data-grid]')];
    expect(grid.length).toBeGreaterThan(1);
    for (const line of grid) {
      expect(num(line, 'y1') % 1).toBe(0.5);
      expect(line.getAttribute('y2')).toBe(line.getAttribute('y1'));
      expect(line).toHaveAttribute('shape-rendering', 'crispEdges');
    }
    const crisp = [...document.querySelectorAll('[shape-rendering="crispEdges"]')];
    expect(crisp.every((element) => element.hasAttribute('data-grid'))).toBe(true);
  });

  it('막대 경계는 정수 화소 — 1px 테두리면 x·y 가 .5, 2px(선택)면 정수, 너비·높이는 정수', () => {
    mockWidth(640.4);
    render(<ComboChart title="t" months={MONTHS} series={SERIES} selectedMonth="2025-03" />);
    const bars = [...document.querySelectorAll('[data-bar]')];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      const offset = bar.getAttribute('stroke-width') === '1' ? 0.5 : 0;
      expect(num(bar, 'x') - offset).toSatisfy(Number.isInteger);
      expect(num(bar, 'y') - offset).toSatisfy(Number.isInteger);
      expect(num(bar, 'width')).toSatisfy(Number.isInteger);
      expect(num(bar, 'height')).toSatisfy(Number.isInteger);
      expect(num(bar, 'height')).toBeGreaterThan(0);
      expect(bar).not.toHaveAttribute('shape-rendering');
    }
    // 선택한 달(2px 테두리) 막대도 있다
    expect(
      bars.some(
        (bar) =>
          bar.getAttribute('data-bar')!.endsWith(':2025-03') &&
          bar.getAttribute('stroke-width') === '2',
      ),
    ).toBe(true);
  });

  it('잰 너비에서도 포인터 x → 칸 계산은 그대로 (툴팁 위치 회귀 없음)', () => {
    mockWidth(640.4);
    render(<ComboChart title="t" months={MONTHS} series={SERIES} />);
    // 좌측 여백 78, 칸 너비 (640.4-156)/4 ≈ 121.1 → 오른쪽 끝 바로 앞은 마지막 달
    fireEvent.pointerMove(plot(), { clientX: 640.4 - 78 - 1, pointerType: 'mouse' });
    expect(tooltip()).toHaveTextContent('2025년 4월');
    fireEvent.pointerMove(plot(), { clientX: 78 + 1, pointerType: 'mouse' });
    expect(tooltip()).toHaveTextContent('2025년 1월');
  });
});
