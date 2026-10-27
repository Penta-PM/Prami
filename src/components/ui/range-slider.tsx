'use client';

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';
import {
  formatMonthDot,
  formatMonthLong,
  nearestMonthIndex,
  parseMonthKey,
  type MonthKey,
} from '@/lib/month';

/**
 * 공용 양쪽 범위 슬라이더 (빠른 필터 바 §7.5). 네이티브 `<input type="range">` 2개를 겹친다 — 값은 칸 번호 0..steps.
 *
 * - 접근성: 네이티브 role=slider + aria-valuemin/max/now·aria-valuetext(valueText — 예: 통화 형식, 끝이면 "제한 없음").
 * - 키보드(브라우저마다 다른 기본 동작 대신 직접 처리): ←↓ −1칸, →↑ +1칸, PageDown/PageUp ∓10칸, Home/End 끝(다른 핸들을 넘지 않음).
 * - 핸들은 교차하지 않는다(하한 ≤ 상한, 같은 칸은 허용).
 * - 트랙 클릭/탭 → 가까운 핸들이 그 칸으로(드래그 대안). 핸들 20px, 터치 영역 44px(input 높이·thumb 히트 영역).
 * - onChange 는 움직이는 동안 매번(표시만), onCommit 은 손을 뗄 때(pointerup·keyup·blur) — 적용 시점은 호출자가 정한다.
 * - 칸의 의미는 호출자가 정한다: 금액 모드(MoneyRangeEditor — 로그 눈금 칸) / 월 모드(아래 MonthRangeSlider — 칸 = 월, 조달이 통합 UI-4).
 * - background: 트랙 뒤에 깔리는 장식(예: 월별 거래량 히스토그램) — 칸 0..steps 와 같은 가로 구간(양 끝 22px 안쪽)에 맞춰 그린다.
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
  /** PageUp/PageDown 이동 칸 수 (기본 RANGE_SLIDER_PAGE — 월 모드는 12) */
  page?: number;
  /** 트랙 뒤 장식(aria-hidden) — 칸 0..steps 와 같은 가로 구간 */
  background?: ReactNode;
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
  page = RANGE_SLIDER_PAGE,
  background,
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
    const next = keyStep(event.key, current, lo, hi, page);
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
      {background !== undefined && (
        <div
          aria-hidden="true"
          data-range-background=""
          className="pointer-events-none absolute inset-x-[22px] inset-y-0"
        >
          {background}
        </div>
      )}
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

// ── 월 모드 (조달이 통합 UI-4 — 조회기간 슬라이더) ─────────────────────────────

/** 조회 기간 (월 단위, 양 끝 포함) — server/procurement 의 MonthPeriod 와 같은 모양 */
export type MonthRangeValue = { from: MonthKey; to: MonthKey };

/** 배경 히스토그램 한 칸 — server/procurement getMonthVolumes().months 와 같은 모양(추가 필드 무시) */
export type MonthVolumeBar = { month: MonthKey; amount: number };

export type MonthRangeSliderProps = {
  /** 고를 수 있는 월(오름차순, 빈 달 포함) — 예: getMonthVolumes().months.map((m) => m.month) */
  months: readonly MonthKey[];
  value: MonthRangeValue;
  /** 움직이는 동안 */
  onChange: (next: MonthRangeValue) => void;
  /** 손을 뗐을 때 (pointerup·keyup·blur) — URL·조회 반영 시점 */
  onCommit?: () => void;
  /** 선택적 배경 히스토그램(월별 거래량) */
  volumes?: readonly MonthVolumeBar[];
  /** 두 핸들의 접근성 이름 [시작, 끝] */
  labels?: readonly [string, string];
  disabled?: boolean;
  className?: string;
};

/** 월 모드 PageUp/PageDown = 12칸(1년) */
export const MONTH_SLIDER_PAGE = 12;

/** 월 모드 aria-valuetext — `2025년 3월` (시작 핸들) / `2025년 3월까지` (끝 핸들) */
export function monthValueText(month: MonthKey, handle: 0 | 1): string {
  return handle === 0 ? `${formatMonthLong(month)}부터` : `${formatMonthLong(month)}까지`;
}

/** `2025.01 ~ 2025.06 (6개월)` */
export function monthRangeText(from: MonthKey, to: MonthKey): string {
  const a = parseMonthKey(from);
  const b = parseMonthKey(to);
  const count = (b.year - a.year) * 12 + (b.month - a.month) + 1;
  return `${formatMonthDot(from)} ~ ${formatMonthDot(to)} (${count}개월)`;
}

/** 값(월) → 칸 [시작, 끝] — 목록에 없는 월은 가까운 칸, 교차하면 끝을 시작에 맞춘다 */
export function monthRangeToSteps(
  months: readonly MonthKey[],
  value: MonthRangeValue,
): RangeSliderValue {
  const lower = nearestMonthIndex(months, value.from);
  const upper = nearestMonthIndex(months, value.to);
  return [lower, Math.max(lower, upper)];
}

/** 월 모드: 칸 = 월(snap). 배경에 월별 거래량 막대(선택 구간은 진하게), 아래에 연도 시작 눈금 라벨 */
export function MonthRangeSlider({
  months,
  value,
  onChange,
  onCommit,
  volumes,
  labels = ['조회 시작 월', '조회 끝 월'],
  disabled = false,
  className,
}: MonthRangeSliderProps) {
  const rangeId = useId();
  if (months.length === 0) {
    return <p className="m-0 text-[12px] text-text-tertiary">고를 수 있는 기간이 없습니다</p>;
  }
  const steps = months.length - 1;
  const [lower, upper] = monthRangeToSteps(months, value);
  const from = months[lower]!;
  const to = months[upper]!;
  // 칸 i 의 중심 위치(%) — RangeSlider 의 칸 위치와 같다
  const at = (index: number) => (steps === 0 ? 50 : (index / steps) * 100);
  const band = 100 / months.length;

  const volumeByMonth = new Map((volumes ?? []).map((bar) => [bar.month, bar.amount]));
  const maxVolume = Math.max(0, ...months.map((month) => volumeByMonth.get(month) ?? 0));
  const background =
    volumes && maxVolume > 0 ? (
      <div data-month-volumes="" className="absolute inset-x-0 top-0 bottom-1/2">
        {months.map((month, index) => {
          const amount = volumeByMonth.get(month) ?? 0;
          if (amount <= 0) return null;
          const inRange = index >= lower && index <= upper;
          return (
            <span
              key={month}
              data-month-volume={month}
              className={cn(
                'absolute bottom-[3px] rounded-t-[1px]',
                inRange ? 'bg-purple-500/45' : 'bg-gray-150',
              )}
              style={{
                left: `${at(index) - band / 2}%`,
                width: `max(1px, calc(${band}% - 1px))`,
                height: `${Math.max(8, (amount / maxVolume) * 100)}%`,
              }}
            />
          );
        })}
      </div>
    ) : undefined;

  // 아래 눈금 라벨: 연도가 바뀌는 달(+ 첫 달). 너무 많으면 2년 간격
  const yearStarts = months
    .map((month, index) => ({ month, index }))
    .filter(({ month, index }) => index === 0 || month.endsWith('-01'));
  const stride = yearStarts.length > 6 ? 2 : 1;

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-1', className)} data-month-range-slider="">
      <output
        id={rangeId}
        className="self-end text-[13px] font-semibold text-text-secondary tabular-nums"
      >
        {monthRangeText(from, to)}
      </output>
      <RangeSlider
        steps={steps}
        value={[lower, upper]}
        onChange={(next) => onChange({ from: months[next[0]]!, to: months[next[1]]! })}
        onCommit={onCommit}
        valueText={(step, handle) => monthValueText(months[step]!, handle)}
        labels={labels}
        disabled={disabled}
        page={MONTH_SLIDER_PAGE}
        background={background}
        aria-describedby={rangeId}
      />
      <div aria-hidden="true" className="relative mx-[22px] h-4 text-[11px] text-text-tertiary">
        {yearStarts
          .filter((_, index) => index % stride === 0)
          .map(({ month, index }) => (
            <span
              key={month}
              className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums"
              style={{ left: `${at(index)}%` }}
            >
              {index === 0 && !month.endsWith('-01')
                ? formatMonthDot(month).slice(2)
                : `${month.slice(0, 4)}년`}
            </span>
          ))}
      </div>
    </div>
  );
}
