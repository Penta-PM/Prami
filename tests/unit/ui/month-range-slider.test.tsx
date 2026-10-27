import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MonthRangeSlider, type MonthRangeValue } from '@/components/ui';
import { monthRangeText, monthRangeToSteps, monthValueText } from '@/components/ui/range-slider';
import { monthRange } from '@/lib/month';

/**
 * RangeSlider 월 모드 (조달이 통합 UI-4): 칸 = 월(snap), aria-valuetext "2025년 3월부터/까지", PageUp/Down 12칸(1년),
 * 교차 금지, 손을 뗄 때 onCommit, 선택적 배경 히스토그램(getMonthVolumes 모양). 합성 거래량만.
 */
const MONTHS = monthRange('2024-01', '2025-06'); // 18칸

function Harness({
  initial = { from: '2024-01', to: '2025-06' },
  volumes,
  onCommit = () => undefined,
}: {
  initial?: MonthRangeValue;
  volumes?: { month: string; amount: number; contractCount?: number }[];
  onCommit?: () => void;
}) {
  const [value, setValue] = useState<MonthRangeValue>(initial);
  return (
    <>
      <MonthRangeSlider
        months={MONTHS}
        value={value}
        onChange={setValue}
        onCommit={onCommit}
        volumes={volumes}
      />
      <output data-testid="value">{`${value.from}~${value.to}`}</output>
    </>
  );
}

const start = () => screen.getByRole('slider', { name: '조회 시작 월' });
const end = () => screen.getByRole('slider', { name: '조회 끝 월' });
const value = () => screen.getByTestId('value').textContent;

describe('MonthRangeSlider — 접근성·표시', () => {
  it('칸 = 월, aria-valuetext 는 "YYYY년 M월부터/까지", 범위 글자(개월 수)', () => {
    render(<Harness initial={{ from: '2024-03', to: '2025-02' }} />);
    expect(start()).toHaveAttribute('aria-valuemin', '0');
    expect(start()).toHaveAttribute('aria-valuemax', '17');
    expect(start()).toHaveAttribute('aria-valuenow', '2');
    expect(start()).toHaveAttribute('aria-valuetext', '2024년 3월부터');
    expect(end()).toHaveAttribute('aria-valuenow', '13');
    expect(end()).toHaveAttribute('aria-valuetext', '2025년 2월까지');
    expect(screen.getByText('2024.03 ~ 2025.02 (12개월)')).toBeInTheDocument();
    // 범위 글자가 슬라이더 설명으로 연결
    const describedBy = start().getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)).toHaveTextContent('2024.03 ~ 2025.02');
  });

  it('연도 눈금 라벨 (aria-hidden)', () => {
    render(<Harness />);
    expect(screen.getByText('2024년').closest('[aria-hidden]')).not.toBeNull();
    expect(screen.getByText('2025년')).toBeInTheDocument();
  });

  it('월이 없으면 안내 문구', () => {
    render(
      <MonthRangeSlider
        months={[]}
        value={{ from: '2025-01', to: '2025-01' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('고를 수 있는 기간이 없습니다')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).toBeNull();
  });
});

describe('MonthRangeSlider — 키보드 (월 snap)', () => {
  it('←→ 1개월, PageUp/PageDown 12개월, Home/End', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: '2024-06', to: '2025-03' }} />);
    start().focus();
    await user.keyboard('{ArrowRight}');
    expect(value()).toBe('2024-07~2025-03');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(value()).toBe('2024-05~2025-03');
    await user.keyboard('{PageUp}');
    expect(value()).toBe('2025-03~2025-03'); // 12칸 앞이지만 끝 핸들을 넘지 못함
    await user.keyboard('{Home}');
    expect(value()).toBe('2024-01~2025-03');
    end().focus();
    await user.keyboard('{PageDown}');
    expect(value()).toBe('2024-01~2024-03');
    await user.keyboard('{End}');
    expect(value()).toBe('2024-01~2025-06');
  });

  it('교차 금지 — 시작은 끝을, 끝은 시작을 넘지 못한다(같은 달 허용), 네이티브 변경도', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: '2024-09', to: '2024-10' }} />);
    start().focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{End}');
    expect(value()).toBe('2024-10~2024-10');
    end().focus();
    await user.keyboard('{ArrowLeft}{Home}');
    expect(value()).toBe('2024-10~2024-10');
    fireEvent.change(start(), { target: { value: '15' } });
    expect(value()).toBe('2024-10~2024-10');
  });

  it('keyup(이동 키)·blur 에 onCommit', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} initial={{ from: '2024-06', to: '2025-03' }} />);
    start().focus();
    await user.keyboard('{ArrowRight}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});

describe('MonthRangeSlider — 배경 히스토그램', () => {
  it('거래량 > 0 인 달마다 막대, 선택 구간은 진하게, 높이는 최대 대비', () => {
    const volumes = MONTHS.map((month, index) => ({
      month,
      amount: index % 3 === 0 ? 0 : (index + 1) * 1_000,
      contractCount: 1,
    }));
    render(<Harness volumes={volumes} initial={{ from: '2024-02', to: '2024-05' }} />);
    const bars = document.querySelectorAll<HTMLElement>('[data-month-volume]');
    expect(bars).toHaveLength(volumes.filter((bar) => bar.amount > 0).length);
    const feb = document.querySelector<HTMLElement>('[data-month-volume="2024-02"]')!;
    const jul = document.querySelector<HTMLElement>('[data-month-volume="2024-08"]')!;
    expect(feb).toHaveClass('bg-purple-500/45');
    expect(jul).toHaveClass('bg-gray-150');
    const max = document.querySelector<HTMLElement>('[data-month-volume="2025-06"]')!;
    expect(max.style.height).toBe('100%');
    expect(document.querySelector('[data-range-background]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('volumes 가 없거나 전부 0 이면 배경 없음', () => {
    render(<Harness volumes={MONTHS.map((month) => ({ month, amount: 0 }))} />);
    expect(document.querySelector('[data-range-background]')).toBeNull();
  });
});

describe('월 모드 순수 함수', () => {
  it('monthValueText·monthRangeText·monthRangeToSteps(목록 밖·교차 값 보정)', () => {
    expect(monthValueText('2025-03', 0)).toBe('2025년 3월부터');
    expect(monthValueText('2025-03', 1)).toBe('2025년 3월까지');
    expect(monthRangeText('2024-11', '2025-02')).toBe('2024.11 ~ 2025.02 (4개월)');
    expect(monthRangeToSteps(MONTHS, { from: '2024-03', to: '2024-05' })).toEqual([2, 4]);
    expect(monthRangeToSteps(MONTHS, { from: '2020-01', to: '2030-01' })).toEqual([0, 17]);
    expect(monthRangeToSteps(MONTHS, { from: '2025-01', to: '2024-01' })).toEqual([12, 12]);
  });
});
