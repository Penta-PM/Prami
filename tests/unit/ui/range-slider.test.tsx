import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RangeSlider, type RangeSliderHandle, type RangeSliderValue } from '@/components/ui';
import { keyStep, nearestHandle, shiftRange, stepFromPointer } from '@/components/ui/range-slider';

/**
 * 공용 양쪽 범위 슬라이더 (빠른 필터 바 §7.5): 네이티브 range 2개, role=slider·aria-valuetext(끝 = "제한 없음"),
 * 키보드 1칸·PageUp/Down 10칸·Home/End, 교차 금지, 트랙 클릭 → 가까운 핸들, 손을 뗄 때 onCommit, 터치 영역 44px,
 * 가운데 드래그(두 값 같은 칸 수 이동·폭 유지·경계 정지, 4px 이하 = 탭).
 */
const STEPS = 200;

function Harness({
  initial = [0, STEPS],
  onCommit = () => undefined,
  onHandle = () => undefined,
  disabled = false,
}: {
  initial?: RangeSliderValue;
  onCommit?: () => void;
  onHandle?: (handle: RangeSliderHandle) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<RangeSliderValue>(initial);
  return (
    <>
      <RangeSlider
        steps={STEPS}
        value={value}
        onChange={(next, handle) => {
          setValue(next);
          onHandle(handle);
        }}
        onCommit={onCommit}
        valueText={(step, handle) =>
          (handle === 0 && step === 0) || (handle === 1 && step === STEPS)
            ? '제한 없음'
            : `₩${step * 1000}`
        }
        labels={['금액 최소', '금액 최대']}
        disabled={disabled}
      />
      <output data-testid="value">{value.join(',')}</output>
    </>
  );
}

const lower = () => screen.getByRole('slider', { name: '금액 최소' });
const upper = () => screen.getByRole('slider', { name: '금액 최대' });
const value = () => screen.getByTestId('value').textContent;

describe('RangeSlider — 접근성', () => {
  it('role=slider 2개, aria-valuemin/max/now, aria-valuetext — 끝이면 "제한 없음"', () => {
    render(<Harness initial={[0, STEPS]} />);
    expect(lower()).toHaveAttribute('type', 'range');
    expect(lower()).toHaveAttribute('aria-valuemin', '0');
    expect(lower()).toHaveAttribute('aria-valuemax', String(STEPS));
    expect(lower()).toHaveAttribute('aria-valuenow', '0');
    expect(lower()).toHaveAttribute('aria-valuetext', '제한 없음');
    expect(upper()).toHaveAttribute('aria-valuenow', String(STEPS));
    expect(upper()).toHaveAttribute('aria-valuetext', '제한 없음');
  });

  it('중간 값이면 valueText 그대로 (통화 형식은 호출자가)', () => {
    render(<Harness initial={[10, 50]} />);
    expect(lower()).toHaveAttribute('aria-valuetext', '₩10000');
    expect(upper()).toHaveAttribute('aria-valuetext', '₩50000');
  });

  it('터치 영역 44px(h-11) 트랙 컨테이너, 핸들 input 은 range-slider-input', () => {
    render(<Harness />);
    const track = document.querySelector('[data-range-slider]')!;
    expect(track).toHaveClass('h-11', 'touch-none');
    expect(lower()).toHaveClass('range-slider-input');
  });

  it('disabled 면 두 핸들 모두 비활성', () => {
    render(<Harness disabled />);
    expect(lower()).toBeDisabled();
    expect(upper()).toBeDisabled();
  });
});

describe('RangeSlider — 키보드', () => {
  it('←→↑↓ 1칸, PageUp/PageDown 10칸', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[50, 150]} />);
    lower().focus();
    await user.keyboard('{ArrowRight}');
    expect(value()).toBe('51,150');
    await user.keyboard('{ArrowUp}');
    expect(value()).toBe('52,150');
    await user.keyboard('{ArrowLeft}{ArrowDown}');
    expect(value()).toBe('50,150');
    await user.keyboard('{PageUp}');
    expect(value()).toBe('60,150');
    await user.keyboard('{PageDown}{PageDown}');
    expect(value()).toBe('40,150');
  });

  it('Home/End — 끝으로, 단 다른 핸들을 넘지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[50, 150]} />);
    lower().focus();
    await user.keyboard('{End}');
    expect(value()).toBe('150,150');
    await user.keyboard('{Home}');
    expect(value()).toBe('0,150');
    upper().focus();
    await user.keyboard('{Home}');
    expect(value()).toBe('0,0');
    await user.keyboard('{End}');
    expect(value()).toBe('0,200');
  });

  it('교차 금지 — 하한은 상한을, 상한은 하한을 넘지 못한다(같은 칸은 허용)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[99, 100]} />);
    lower().focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{PageUp}');
    expect(value()).toBe('100,100');
    upper().focus();
    await user.keyboard('{ArrowLeft}{PageDown}');
    expect(value()).toBe('100,100');
    // 네이티브 값 변경(드래그)도 교차하지 않는다
    fireEvent.change(lower(), { target: { value: '180' } });
    expect(value()).toBe('100,100');
    fireEvent.change(upper(), { target: { value: '20' } });
    expect(value()).toBe('100,100');
  });

  it('keyup(이동 키)·blur 에 onCommit — 다른 키는 아님', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={[50, 150]} onCommit={onCommit} />);
    lower().focus();
    await user.keyboard('a');
    expect(onCommit).not.toHaveBeenCalled();
    await user.keyboard('{ArrowRight}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});

describe('RangeSlider — 트랙 클릭/탭', () => {
  const rect = { left: 0, width: 244, top: 0, height: 44, right: 244, bottom: 44, x: 0, y: 0 };

  it('가까운 핸들이 그 칸으로 이동하고 손을 떼면 onCommit', () => {
    const onCommit = vi.fn();
    render(<Harness initial={[50, 150]} onCommit={onCommit} />);
    const track = document.querySelector<HTMLElement>('[data-range-slider]')!;
    track.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
    // usable 200px(양 끝 22px) → x = 22 + 칸
    fireEvent.pointerDown(track, { clientX: 22 + 10 });
    expect(value()).toBe('10,150');
    expect(lower()).toHaveFocus();
    fireEvent.pointerUp(track);
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(track, { clientX: 22 + 190 });
    expect(value()).toBe('10,190');
    expect(upper()).toHaveFocus();
  });

  it('순수 함수 — 포인터 → 칸, 가까운 핸들, 키 → 칸', () => {
    expect(stepFromPointer(22, { left: 0, width: 244 }, STEPS)).toBe(0);
    expect(stepFromPointer(0, { left: 0, width: 244 }, STEPS)).toBe(0);
    expect(stepFromPointer(222, { left: 0, width: 244 }, STEPS)).toBe(200);
    expect(stepFromPointer(500, { left: 0, width: 244 }, STEPS)).toBe(200);
    expect(nearestHandle(10, [50, 150])).toBe(0);
    expect(nearestHandle(190, [50, 150])).toBe(1);
    expect(nearestHandle(90, [50, 150])).toBe(0);
    expect(nearestHandle(110, [50, 150])).toBe(1);
    expect(keyStep('PageUp', 195, 0, 200)).toBe(200);
    expect(keyStep('Home', 50, 20, 200)).toBe(20);
    expect(keyStep('Tab', 50, 0, 200)).toBeNull();
  });
});

describe('RangeSlider — 가운데 드래그', () => {
  // usable 200px(양 끝 22px) → 1px = 1칸, x = 22 + 칸
  const rect = { left: 0, width: 244, top: 0, height: 44, right: 244, bottom: 44, x: 0, y: 0 };
  const mount = (props: Parameters<typeof Harness>[0]) => {
    render(<Harness {...props} />);
    const track = document.querySelector<HTMLElement>('[data-range-slider]')!;
    track.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
    return { track, middle: () => document.querySelector<HTMLElement>('[data-range-middle]') };
  };

  it('가운데 영역: 선택 구간 위치, aria-hidden, 포커스 대상 아님, cursor-grab → 끄는 동안 grabbing', () => {
    const { track, middle } = mount({ initial: [50, 150] });
    expect(middle()).toHaveAttribute('aria-hidden', 'true');
    expect(middle()).not.toHaveAttribute('tabindex');
    expect(middle()!.style.left).toBe('25%');
    expect(middle()!.style.right).toBe('25%');
    expect(middle()).toHaveClass('cursor-grab');
    fireEvent.pointerDown(middle()!, { clientX: 22 + 100 });
    expect(middle()).toHaveClass('cursor-grabbing');
    fireEvent.pointerUp(track, { clientX: 22 + 100 });
    expect(middle()).toHaveClass('cursor-grab');
  });

  it("두 값이 같은 칸 수만큼 이동(폭 유지), 경계에서 멈춤, handle = 'both', onCommit 은 손을 뗄 때 1회", () => {
    const onCommit = vi.fn();
    const onHandle = vi.fn();
    const { track, middle } = mount({ initial: [50, 150], onCommit, onHandle });
    fireEvent.pointerDown(middle()!, { clientX: 22 + 100 });
    fireEvent.pointerMove(track, { clientX: 22 + 130 });
    expect(value()).toBe('80,180');
    expect(onHandle).toHaveBeenLastCalledWith('both');
    // 오른쪽 경계 — 상한이 200 에서 멈추고 폭 100 유지(반대편으로 밀리지 않음)
    fireEvent.pointerMove(track, { clientX: 22 + 400 });
    expect(value()).toBe('100,200');
    // 왼쪽 경계
    fireEvent.pointerMove(track, { clientX: -300 });
    expect(value()).toBe('0,100');
    fireEvent.pointerMove(track, { clientX: 22 + 90 });
    expect(value()).toBe('40,140');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(track, { clientX: 22 + 90 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(value()).toBe('40,140');
    // 손을 뗀 뒤 움직임은 무시
    fireEvent.pointerMove(track, { clientX: 22 + 150 });
    expect(value()).toBe('40,140');
  });

  it('pointercancel 도 손을 뗀 것 — onCommit 1회', () => {
    const onCommit = vi.fn();
    const { track, middle } = mount({ initial: [50, 150], onCommit });
    fireEvent.pointerDown(middle()!, { clientX: 22 + 100 });
    fireEvent.pointerMove(track, { clientX: 22 + 110 });
    fireEvent.pointerCancel(track, { clientX: 22 + 110 });
    expect(value()).toBe('60,160');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('터치(pointerType touch)도 같다', () => {
    const onCommit = vi.fn();
    const { track, middle } = mount({ initial: [50, 150], onCommit });
    fireEvent.pointerDown(middle()!, { clientX: 22 + 100, pointerType: 'touch' });
    fireEvent.pointerMove(track, { clientX: 22 + 80, pointerType: 'touch' });
    expect(value()).toBe('30,130');
    fireEvent.pointerUp(track, { clientX: 22 + 80, pointerType: 'touch' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('4px 이하로 끝나면 탭 — 손을 뗄 때 가까운 핸들이 그 칸으로(기존 동작), onCommit 1회', () => {
    const onCommit = vi.fn();
    const onHandle = vi.fn();
    const { track, middle } = mount({ initial: [50, 150], onCommit, onHandle });
    fireEvent.pointerDown(middle()!, { clientX: 22 + 60 });
    fireEvent.pointerMove(track, { clientX: 22 + 64 });
    expect(value()).toBe('50,150');
    fireEvent.pointerUp(track, { clientX: 22 + 64 });
    expect(value()).toBe('64,150');
    expect(onHandle).toHaveBeenCalledWith(0);
    expect(onHandle).not.toHaveBeenCalledWith('both');
    expect(lower()).toHaveFocus();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('폭 0·전체 범위·disabled 면 가운데 영역 없음', () => {
    const { unmount } = render(<Harness initial={[100, 100]} />);
    expect(document.querySelector('[data-range-middle]')).toBeNull();
    unmount();
    const full = render(<Harness initial={[0, STEPS]} />);
    expect(document.querySelector('[data-range-middle]')).toBeNull();
    full.unmount();
    render(<Harness initial={[50, 150]} disabled />);
    expect(document.querySelector('[data-range-middle]')).toBeNull();
  });

  it('핸들 터치 영역(44px)보다 좁은 구간은 가운데 드래그 없이 기존 탭(누르는 즉시 가까운 핸들)', () => {
    const onHandle = vi.fn();
    const { track, middle } = mount({ initial: [50, 80], onHandle }); // 30px
    fireEvent.pointerDown(middle()!, { clientX: 22 + 70 });
    expect(value()).toBe('50,70');
    fireEvent.pointerMove(track, { clientX: 22 + 120 });
    fireEvent.pointerUp(track, { clientX: 22 + 120 });
    expect(value()).toBe('50,70');
    expect(onHandle).not.toHaveBeenCalledWith('both');
  });

  it('순수 함수 shiftRange — δ 를 [-l0, steps-u0] 로 제한', () => {
    expect(shiftRange([50, 150], 30, STEPS)).toEqual([80, 180]);
    expect(shiftRange([50, 150], 999, STEPS)).toEqual([100, 200]);
    expect(shiftRange([50, 150], -999, STEPS)).toEqual([0, 100]);
    expect(shiftRange([0, 10], -5, STEPS)).toEqual([0, 10]);
  });
});
