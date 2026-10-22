'use client';

import { useId, useState } from 'react';

import { cn } from '@/lib/cn';
import {
  FILTER_LIMITS,
  selectedCurrency,
  validateCondition,
  withoutColumn,
  type FilterCondition,
} from '@/lib/table/filter';
import {
  isOutsideRange,
  MONEY_SLIDER_STEPS,
  moneyCompact,
  moneyFull,
  moneyRangeText,
  moneyScaleState,
  stepToValue,
  stepValue,
  valueToStep,
  type MoneyHandle,
  type MoneyRange,
} from '@/lib/table/money-range';

import { Radio } from '../checkbox';
import { RangeSlider, type RangeSliderValue } from '../range-slider';
import type { DataTableFilterField } from './filter-fields';
import { filtersKey } from './pending-filters';

/**
 * money(판매가·원가·금액) 범위 편집 — 양쪽 슬라이더, 숫자 입력 없음 (빠른 필터 바 §7.5, 사용자 확정).
 *
 * - 통화: 단일 통화가 정해지지 않았으면 라디오 먼저(슬라이더 disabled + "통화를 먼저 선택하세요"). 라디오 선택 = 통화 조건 즉시 적용
 *   (enum 과 같은 경로 onToggle), 통화를 바꾸면 범위 초기화. 선택지가 1개면 미리 선택(범위를 기록할 때 통화 조건도 함께).
 * - 범위 = 그 통화의 표 전체 최소·최대(field.ranges), 로그 눈금. 행 없음·값 1개뿐이면 슬라이더 대신 문구.
 * - 적용: 손을 뗄 때(pointerup·keyup·blur) onStage — 바가 400ms 디바운스·대기 조건(R1)·flush 로 보낸다. 팝오버는 열린 채.
 * - 양 끝 = 조건 없음. 옛 URL·범위 밖 값: 핸들은 가까운 칸, 글자·aria 는 URL 실제 값 — 움직인 핸들만 다시 기록한다.
 */
export type MoneyRangeEditorProps<T> = {
  field: DataTableFilterField<T>;
  fields: readonly DataTableFilterField<T>[];
  filters: readonly FilterCondition[];
  /** 통화 라디오 — 다음 전체 조건(즉시 적용 경로) */
  onToggle: (next: FilterCondition[]) => void;
  /** 범위 확정 — 다음 전체 조건(디바운스 경로, 팝오버 유지) */
  onStage: (next: FilterCondition[]) => void;
};

const LABEL_CLASS = 'text-[12px] font-semibold text-text-secondary';
const NOTE_CLASS = 'm-0 text-[12px] text-text-tertiary';
const LIMIT_MESSAGE = `조건은 최대 ${FILTER_LIMITS.conditionsMax}개까지 걸 수 있습니다`;
const OUTSIDE = '현재 데이터 범위 밖';

function scalar(conds: readonly FilterCondition[], col: string, op: 'gte' | 'lte'): string | null {
  const found = conds.find((cond) => cond.col === col && cond.op === op);
  return found && found.op !== 'in' ? found.value : null;
}

const sameCurrency = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function MoneyRangeEditor<T>({
  field,
  fields,
  filters,
  onToggle,
  onStage,
}: MoneyRangeEditorProps<T>) {
  const id = useId();
  const def = field.filter;
  const [error, setError] = useState<string | null>(null);

  const currencyCol = def.kind === 'money' ? def.currencyCol : undefined;
  const currencyDef = currencyCol
    ? fields.find((item) => item.id === currencyCol)?.filter
    : undefined;
  const currencyOptions = currencyDef?.kind === 'enum' ? currencyDef.options : [];
  const ranges = field.ranges ?? [];
  const selected = currencyCol ? selectedCurrency(filters, def) : null;
  // 통화 열이 없는 money 는 범위가 하나일 때만 그 통화로 본다
  const currency = currencyCol
    ? (selected ?? (currencyOptions.length === 1 ? (currencyOptions[0]?.value ?? null) : null))
    : ranges.length === 1
      ? (ranges[0]?.currency ?? null)
      : null;
  const range = currency ? ranges.find((item) => sameCurrency(item.currency, currency)) : undefined;
  const state = moneyScaleState(range);
  const gte = scalar(filters, field.id, 'gte');
  const lte = scalar(filters, field.id, 'lte');

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hintId, error ? errorId : null].filter(Boolean).join(' ');

  const currencyCondition = (value: string): FilterCondition | undefined =>
    currencyCol && currencyDef
      ? validateCondition(
          { col: currencyCol, op: 'in', values: [value] },
          { [currencyCol]: currencyDef },
        )
      : undefined;

  /** 통화 라디오 — 통화 조건 즉시 적용, 범위 초기화 */
  const chooseCurrency = (value: string) => {
    if (!currencyCol || (selected !== null && sameCurrency(selected, value))) return;
    const valid = currencyCondition(value);
    if (!valid) return setError('선택할 수 없는 통화입니다');
    const rest = withoutColumn(withoutColumn(filters, currencyCol), field.id);
    if (rest.length + 1 > FILTER_LIMITS.conditionsMax) return setError(LIMIT_MESSAGE);
    setError(null);
    onToggle([...rest, valid]);
  };

  /** 슬라이더 확정 — 바뀐 것이 없으면 보내지 않는다 */
  const commit = (lower: string | null, upper: string | null) => {
    let rest = withoutColumn(filters, field.id);
    const extra: FilterCondition[] = [];
    // 미리 선택된(선택지 1개) 통화는 범위를 기록할 때 통화 조건도 함께 (두 조건 동시 검증 — §2.3)
    if ((lower !== null || upper !== null) && currencyCol && selected === null && currency) {
      const valid = currencyCondition(currency);
      if (!valid) return setError('선택할 수 없는 통화입니다');
      rest = withoutColumn(rest, currencyCol);
      extra.push(valid);
    }
    const defs = { [field.id]: def };
    for (const [op, value] of [
      ['gte', lower],
      ['lte', upper],
    ] as const) {
      if (value === null) continue;
      const valid = validateCondition({ col: field.id, op, value }, defs);
      if (!valid) return setError('금액 형식이 올바르지 않습니다');
      extra.push(valid);
    }
    const next = [...rest, ...extra];
    if (filtersKey(next) === filtersKey(filters)) return;
    if (next.length > FILTER_LIMITS.conditionsMax) return setError(LIMIT_MESSAGE);
    setError(null);
    onStage(next);
  };

  return (
    <div className="flex flex-col gap-3" data-money-range-editor="">
      {currencyCol && currencyOptions.length > 0 ? (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className={cn('mb-1 p-0', LABEL_CLASS)}>통화</legend>
          <div className="flex flex-wrap gap-x-1.5">
            {currencyOptions.map((option) => (
              <label
                key={option.value}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-1.5 text-[13px] text-ink-900 hover:bg-gray-75"
              >
                <Radio
                  name={`${id}-currency`}
                  value={option.value}
                  checked={currency !== null && sameCurrency(currency, option.value)}
                  onChange={() => chooseCurrency(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {currency === null ? (
        <>
          <p id={hintId} className="m-0 text-[12px] font-semibold text-text-secondary">
            {currencyCol && currencyOptions.length === 0
              ? '고를 수 있는 통화가 없습니다'
              : '통화를 먼저 선택하세요'}
          </p>
          <RangeSlider
            steps={MONEY_SLIDER_STEPS}
            value={[0, MONEY_SLIDER_STEPS]}
            onChange={() => undefined}
            valueText={() => '제한 없음'}
            labels={[`${field.label} 최소`, `${field.label} 최대`]}
            disabled
            aria-describedby={hintId}
          />
        </>
      ) : state.kind === 'scale' ? (
        <MoneySlider
          // 통화가 바뀌면 새 슬라이더(범위 초기화)
          key={state.range.currency}
          label={field.label}
          currency={currency}
          range={state.range}
          gte={gte}
          lte={lte}
          hintId={hintId}
          describedBy={describedBy}
          onCommit={commit}
        />
      ) : (
        <p id={hintId} className="m-0 text-[12px] font-semibold text-text-secondary">
          {state.kind === 'single'
            ? `이 통화의 ${field.label}은(는) 값이 하나뿐입니다 (${moneyFull(state.value, currency)})`
            : ranges.length === 0 && field.ranges === undefined
              ? '범위 정보가 없습니다'
              : `이 통화의 ${field.label} 데이터가 없습니다`}
          {gte !== null || lte !== null ? ` · 현재 조건 ${moneyRangeText(gte, lte, currency)}` : ''}
        </p>
      )}

      {error ? (
        <p id={errorId} role="alert" className="m-0 text-[12px] text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type MoneySliderProps = {
  label: string;
  currency: string;
  range: MoneyRange;
  /** URL(대기 중 포함) 조건 값 — 움직이지 않은 핸들은 이 값을 그대로 둔다 */
  gte: string | null;
  lte: string | null;
  hintId: string;
  describedBy: string;
  onCommit: (lower: string | null, upper: string | null) => void;
};

const HANDLES: readonly MoneyHandle[] = ['lower', 'upper'];

function MoneySlider({
  label,
  currency,
  range,
  gte,
  lte,
  hintId,
  describedBy,
  onCommit,
}: MoneySliderProps) {
  const initial = [gte, lte] as const;
  const [steps, setSteps] = useState<RangeSliderValue>(() => [
    gte !== null ? valueToStep(Number(gte), 'lower', range) : 0,
    lte !== null ? valueToStep(Number(lte), 'upper', range) : MONEY_SLIDER_STEPS,
  ]);
  // 움직인 핸들만 다시 기록한다 — 옛 URL·범위 밖 값은 사용자가 그 핸들을 움직이기 전까지 그대로
  const [touched, setTouched] = useState<readonly [boolean, boolean]>([false, false]);

  const valueOf = (handle: 0 | 1): string | null =>
    touched[handle]
      ? stepToValue(steps[handle], HANDLES[handle] as MoneyHandle, range)
      : initial[handle];

  const lower = valueOf(0);
  const upper = valueOf(1);
  const outside = ([0, 1] as const).some((handle) => {
    const value = initial[handle];
    return !touched[handle] && value !== null && isOutsideRange(Number(value), range);
  });

  const valueText = (step: number, handle: 0 | 1) => {
    const urlValue = initial[handle];
    if (!touched[handle] && urlValue !== null)
      return `${moneyFull(urlValue, currency)}${isOutsideRange(Number(urlValue), range) ? ` (${OUTSIDE})` : ''}`;
    const value = stepToValue(step, HANDLES[handle] as MoneyHandle, range);
    return value === null ? '제한 없음' : moneyFull(value, currency);
  };

  return (
    <div className="flex flex-col gap-1">
      <p data-money-range-text="" className="m-0 text-[13px] font-semibold text-ink-900">
        {moneyRangeText(lower, upper, currency)}
        {outside ? <span className="font-normal text-text-tertiary"> · {OUTSIDE}</span> : null}
      </p>
      <RangeSlider
        steps={MONEY_SLIDER_STEPS}
        value={steps}
        onChange={(next, handle) => {
          setSteps(next);
          setTouched((prev) => (handle === 0 ? [true, prev[1]] : [prev[0], true]));
        }}
        onCommit={() => onCommit(lower, upper)}
        valueText={valueText}
        labels={[`${label} 최소`, `${label} 최대`]}
        aria-describedby={describedBy}
      />
      <div
        aria-hidden="true"
        className="flex justify-between gap-2 px-1 text-[11px] text-text-tertiary"
      >
        <span>{moneyCompact(stepValue(0, 'lower', range), currency)}</span>
        <span>{moneyCompact(range.max, currency)}</span>
      </div>
      <p id={hintId} className={NOTE_CLASS}>
        로그 눈금 — 작은 금액일수록 세밀하게 움직입니다. 양 끝은 제한 없음
      </p>
    </div>
  );
}
