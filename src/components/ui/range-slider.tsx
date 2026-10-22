'use client';

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { cn } from '@/lib/cn';

/**
 * 공용 양쪽 범위 슬라이더 (빠른 필터 바 §7.5). 네이티브 `<input type="range">` 2개를 겹친다 — 값은 칸 번호 0..steps.
 *
 * - 접근성: 네이티브 role=slider + aria-valuemin/max/now·aria-valuetext(valueText — 예: 통화 형식, 끝이면 "제한 없음").
 * - 키보드(브라우저마다 다른 기본 동작 대신 직접 처리): ←↓ −1칸, →↑ +1칸, PageDown/PageUp ∓10칸, Home/End 끝(다른 핸들을 넘지 않음).
 * - 핸들은 교차하지 않는다(하한 ≤ 상한, 같은 칸은 허용).
 * - 트랙 클릭/탭 → 가까운 핸들이 그 칸으로(드래그 대안). 핸들 20px, 터치 영역 44px(input 높이·thumb 히트 영역).
 * - onChange 는 움직이는 동안 매번(표시만), onCommit 은 손을 뗄 때(pointerup·keyup·blur) — 적용 시점은 호출자가 정한다.
 */
export type RangeSliderValue = readonly [number, number];

export type RangeSliderProps = {
  /** 마지막 칸 번호 (값은 0..steps) */
  steps: number;
  value: RangeSliderValue;
  /** 움직이는 동안 — 다음 값과 움직인 핸들(0 = 하한, 1 = 상한) */
  onChange: (next: RangeSliderValue, handle: 0 | 1) => void;
  /** 손을 뗐을 때 (pointerup·keyup·blur) */
  onCommit?: () => void;
  /** aria-valuetext */
  valueText: (step: number, handle: 0 | 1) => string;
  /** 두 핸들의 접근성 이름 [하한, 상한] */
  labels: readonly [string, string];
  disabled?: boolean;
  'aria-describedby'?: string;
  className?: string;
};

/** PageUp/PageDown 이동 칸 수 */
export const RANGE_SLIDER_PAGE = 10;

const NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);

/** 키 → 다음 칸 (교차 금지 범위 [lo, hi] 안). 처리하지 않는 키면 null */
export function keyStep(
  key: string,
  current: number,
  lo: number,
  hi: number,
  page: number = RANGE_SLIDER_PAGE,
): number | null {
  let next: number;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      next = current - 1;
      break;
    case 'ArrowRight':
    case 'ArrowUp':
      next = current + 1;
      break;
    case 'PageDown':
      next = current - page;
      break;
    case 'PageUp':
      next = current + page;
      break;
    case 'Home':
      next = lo;
      break;
    case 'End':
      next = hi;
      break;
    default:
      return null;
  }
  return Math.min(hi, Math.max(lo, next));
}

/** 트랙 위 칸에 가까운 핸들 — 같은 거리면 움직일 수 있는 쪽(칸이 하한보다 왼쪽이면 하한, 아니면 상한) */
export function nearestHandle(step: number, value: RangeSliderValue): 0 | 1 {
  const [lower, upper] = value;
  if (step < lower) return 0;
  if (step > upper) return 1;
  return step - lower <= upper - step ? 0 : 1;
}

/** 핸들 thumb 의 히트 영역(px) — 트랙 양 끝 여백도 이만큼의 절반 */
const THUMB = 44;

/** 포인터 x → 칸 (thumb 중심이 움직이는 구간 기준) */
export function stepFromPointer(
  clientX: number,
  rect: { left: number; width: number },
  steps: number,
): number {
  const usable = Math.max(1, rect.width - THUMB);
  const ratio = (clientX - rect.left - THUMB / 2) / usable;
  return Math.min(steps, Math.max(0, Math.round(ratio * steps)));
}

export function RangeSlider({
  steps,
  value,
  onChange,
  onCommit,
  valueText,
  labels,
  disabled = false,
  'aria-describedby': describedBy,
  className,
}: RangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<0 | 1 | null>(null);
  const [lower, upper] = value;

  const set = (handle: 0 | 1, step: number) => {
    const next: [number, number] =
      handle === 0
        ? [Math.min(Math.max(0, step), upper), upper]
        : [lower, Math.max(Math.min(steps, step), lower)];
    setActive(handle);
    if (next[0] !== lower || next[1] !== upper) onChange(next, handle);
  };

  const onKeyDown = (handle: 0 | 1) => (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const current = handle === 0 ? lower : upper;
    const [lo, hi] = handle === 0 ? [0, upper] : [lower, steps];
    const next = keyStep(event.key, current, lo, hi);
    if (next === null) return;
    event.preventDefault();
    set(handle, next);
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (NAV_KEYS.has(event.key)) onCommit?.();
  };

  // 트랙 클릭/탭 — input 은 pointer-events 가 꺼져 있고(thumb 만 켜짐) 트랙은 이 div 가 받는다
  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.target instanceof HTMLInputElement) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const step = stepFromPointer(event.clientX, rect, steps);
    const handle = nearestHandle(step, value);
    set(handle, step);
    // 움직인 핸들로 포커스 — 이어서 키보드로 조정할 수 있게
    trackRef.current
      ?.querySelector<HTMLInputElement>(`[data-range-handle="${handle}"]`)
      ?.focus({ preventScroll: true });
  };

  const pct = (step: number) => (steps === 0 ? 0 : (step / steps) * 100);
  // 두 핸들이 겹치면 움직일 수 있는 쪽이 위 — 오른쪽 끝에 붙으면 하한, 아니면 마지막으로 움직인 핸들
  const lowerOnTop = lower === upper ? lower > steps / 2 : active === 0;

  const input = (handle: 0 | 1) => {
    const step = handle === 0 ? lower : upper;
    return (
      <input
        type="range"
        data-range-handle={handle}
        min={0}
        max={steps}
        step={1}
        value={step}
        disabled={disabled}
        aria-label={labels[handle]}
        aria-valuemin={0}
        aria-valuemax={steps}
        aria-valuenow={step}
        aria-valuetext={valueText(step, handle)}
        aria-describedby={describedBy}
        onChange={(event) => set(handle, Number(event.target.value))}
        onKeyDown={onKeyDown(handle)}
        onKeyUp={onKeyUp}
        onBlur={() => onCommit?.()}
        className={cn(
          'range-slider-input absolute inset-0 m-0 h-full w-full',
          (handle === 0) === lowerOnTop ? 'z-20' : 'z-10',
        )}
      />
    );
  };

  return (
    <div
      ref={trackRef}
      data-range-slider=""
      onPointerDown={onTrackPointerDown}
      onPointerUp={() => {
        if (!disabled) onCommit?.();
      }}
      className={cn(
        'relative h-11 w-full min-w-0 touch-none select-none',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      {/* 트랙(회색) + 선택 구간(보라) — thumb 중심이 움직이는 구간에 맞춰 양 끝 22px 안쪽 */}
      <div aria-hidden="true" className="absolute inset-x-[22px] top-1/2 h-1 -translate-y-1/2">
        <div className="absolute inset-0 rounded-full bg-gray-200" />
        <div
          data-range-fill=""
          className="absolute inset-y-0 rounded-full bg-purple-600"
          style={{ left: `${pct(lower)}%`, right: `${100 - pct(upper)}%` }}
        />
      </div>
      {input(0)}
      {input(1)}
    </div>
  );
}
