'use client';

import { useId, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { cn } from '@/lib/cn';
import {
  FILTER_LIMITS,
  validateCondition,
  withoutColumn,
  type ColumnFilterDef,
  type FilterCondition,
  type FilterOption,
} from '@/lib/table/filter';

import { Button } from '../button';
import { Checkbox } from '../checkbox';
import { chipClass } from '../chip';
import type { DataTableFilterField } from './filter-fields';
import { MoneyRangeEditor } from './MoneyRangeEditor';
import { DATE_PRESETS, datePresetRange } from './quick-filters';

/**
 * 빠른 필터 바의 필드 편집 팝오버 내용 (표 열 필터 빠른 필터 바 §2.3). 조건 목록 전체를 받아 다음 전체 목록을 돌려준다
 * (다른 열 조건은 그대로). 검증·한도·trim·중복 제거·이스케이프는 기존 규칙(validateCondition·FILTER_LIMITS) 그대로.
 *
 * - enum: 체크 즉시 onToggle(디바운스·적용 시점은 바가 정한다), 팝오버는 열린 채. "선택 해제" 로 그 열만 해제. 적용 버튼 없음.
 * - text: 포함/같음 2버튼 토글(기본 포함) + 값, Enter 또는 "적용"(입력·한글 조합 중에는 요청 없음).
 * - date: 프리셋(오늘·최근 7일·최근 30일·이번 달)은 누르면 바로 onApply, 시작·종료 입력은 Enter/적용.
 * - number(가격 변동률): 최소·최대 입력 + Enter/적용.
 * - money(판매가·원가·금액): 양쪽 슬라이더(숫자 입력 없음, §7.5) — MoneyRangeEditor. 통화 라디오는 즉시 적용(onToggle),
 *   범위는 손을 뗄 때 onStage(바가 디바운스), 팝오버는 열린 채.
 */
export type QuickFilterEditorProps<T> = {
  field: DataTableFilterField<T>;
  /** 표의 모든 필터 필드 — money 의 통화 열(currencyCol) 선택지를 찾는다 */
  fields: readonly DataTableFilterField<T>[];
  /** 현재 조건(대기 중 요청 포함 — 바의 기준값) */
  filters: readonly FilterCondition[];
  /** enum 체크 변경 — 다음 전체 조건 */
  onToggle: (next: FilterCondition[]) => void;
  /** 적용(Enter·적용·날짜 프리셋) — 다음 전체 조건. 바가 팝오버를 닫는다 */
  onApply: (next: FilterCondition[]) => void;
  /** money 슬라이더 확정 — 다음 전체 조건. 바가 디바운스해 보내고 팝오버는 열어 둔다 (§7.5) */
  onStage: (next: FilterCondition[]) => void;
};

const LABEL_CLASS = 'text-[12px] font-semibold text-text-secondary';
const FIELD_CLASS =
  'w-full min-w-0 rounded-lg border-0 bg-gray-75 px-3 py-2 text-[13px] text-ink-900 shadow-(--hairline-default) outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--purple-500)] disabled:cursor-not-allowed disabled:opacity-50';

/** enum 목록 행 (§7.2) — 행 전체가 클릭 영역(label), 40px 이상. 선택 행은 옅은 보라 + font-medium */
export const OPTION_ROW_CLASS =
  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-900';
export const OPTION_ROW_IDLE = 'hover:bg-gray-75';
export const OPTION_ROW_SELECTED = 'bg-purple-600/8 font-medium';

const LIMIT_MESSAGE = `조건은 최대 ${FILTER_LIMITS.conditionsMax}개까지 걸 수 있습니다`;

function scalarValue(conds: readonly FilterCondition[], op: 'gte' | 'lte'): string {
  const found = conds.find((cond) => cond.op === op);
  return found && found.op !== 'in' ? found.value : '';
}

/** 숫자 입력의 천 단위 쉼표·공백은 허용하고 지운다 ("1,000" → "1000") */
function normalizeNumber(value: string): string {
  return value.replace(/[,\s]/g, '');
}

function invalidMessage(def: ColumnFilterDef): string {
  switch (def.kind) {
    case 'text':
      return `${FILTER_LIMITS.valueMax}자 이내로 입력하세요`;
    case 'enum':
      return `최대 ${FILTER_LIMITS.inMax}개까지 선택할 수 있습니다`;
    case 'date':
      return '날짜 형식이 올바르지 않습니다';
    default:
      return '숫자만 입력하세요';
  }
}

/** 범위(gte·lte) 조건 검증 — 성공하면 조건 목록, 실패하면 오류 문구 */
function rangeConditions(
  col: string,
  def: ColumnFilterDef,
  min: string,
  max: string,
): FilterCondition[] | string {
  const lo = def.kind === 'date' ? min : normalizeNumber(min);
  const hi = def.kind === 'date' ? max : normalizeNumber(max);
  const defs = { [col]: def };
  const out: FilterCondition[] = [];
  for (const [op, value] of [
    ['gte', lo],
    ['lte', hi],
  ] as const) {
    if (!value.trim()) continue;
    const valid = validateCondition({ col, op, value }, defs);
    if (!valid) return invalidMessage(def);
    out.push(valid);
  }
  const [first, second] = out;
  if (first?.op === 'gte' && second?.op === 'lte') {
    const reversed =
      def.kind === 'date' ? first.value > second.value : Number(first.value) > Number(second.value);
    if (reversed)
      return def.kind === 'date' ? '시작일이 종료일보다 늦습니다' : '최소값이 최대값보다 큽니다';
  }
  return out;
}

export function QuickFilterEditor<T>(props: QuickFilterEditorProps<T>) {
  const def = props.field.filter;
  if (def.kind === 'enum') return <EnumEditor {...props} options={def.options} />;
  if (def.kind === 'text') return <TextEditor {...props} />;
  if (def.kind === 'money') return <MoneyRangeEditor {...props} />;
  return <RangeEditor {...props} />;
}

// ── enum ─────────────────────────────────────────────────────────────────

function EnumEditor<T>({
  field,
  filters,
  onToggle,
  options,
}: QuickFilterEditorProps<T> & { options: readonly FilterOption[] }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const checked = filters.find((cond) => cond.col === field.id && cond.op === 'in');
  const values = checked && checked.op === 'in' ? checked.values : [];
  const errorId = `${id}-error`;

  const change = (nextValues: readonly string[]) => {
    const rest = withoutColumn(filters, field.id);
    if (nextValues.length === 0) {
      setError(null);
      return onToggle(rest);
    }
    const valid = validateCondition(
      { col: field.id, op: 'in', values: [...nextValues] },
      { [field.id]: field.filter },
    );
    if (!valid) return setError(invalidMessage(field.filter));
    if (rest.length + 1 > FILTER_LIMITS.conditionsMax) return setError(LIMIT_MESSAGE);
    setError(null);
    onToggle([...rest, valid]);
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset
        className="m-0 flex min-w-0 flex-col border-0 p-0"
        aria-describedby={error ? errorId : undefined}
      >
        <legend className={cn('mb-2 p-0', LABEL_CLASS)}>{field.label}</legend>
        {/* 선택지가 많으면(감사 행위 등) 목록만 스크롤 */}
        <div
          data-filter-options
          className="-mx-1 flex max-h-[min(280px,45vh)] flex-col gap-0.5 overflow-y-auto px-1"
        >
          {options.map((option) => {
            const selected = values.includes(option.value);
            return (
              <label
                key={option.value}
                data-filter-option={option.value}
                className={cn(OPTION_ROW_CLASS, selected ? OPTION_ROW_SELECTED : OPTION_ROW_IDLE)}
              >
                <Checkbox
                  checked={selected}
                  onChange={(event) =>
                    change(
                      event.target.checked
                        ? // 정의 순서(statusOrder·options 순)로 유지 — 선택지에 없는 URL 값은 뒤에 그대로
                          [
                            ...options
                              .map((item) => item.value)
                              .filter((value) => value === option.value || values.includes(value)),
                            ...values.filter(
                              (value) => !options.some((item) => item.value === value),
                            ),
                          ]
                        : values.filter((value) => value !== option.value),
                    )
                  }
                />
                <span className="min-w-0 break-words">{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {error ? (
        <p id={errorId} role="alert" className="m-0 text-[12px] text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
        <span data-filter-selected-count="" className="text-[12px] text-text-tertiary">
          {values.length}개 선택됨
        </span>
        <Button size="sm" variant="ghost" disabled={values.length === 0} onClick={() => change([])}>
          선택 해제
        </Button>
      </div>
    </div>
  );
}

// ── 공용 폼 (text·range) ───────────────────────────────────────────────────

/** Enter = 적용 — 라디오·버튼은 브라우저의 암묵적 제출이 없으므로 직접 처리한다. 한글 조합 중 Enter 는 무시 */
function enterSubmits(submit: () => void) {
  return (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter') return;
    if (event.nativeEvent.isComposing) {
      event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    event.preventDefault();
    submit();
  };
}

function ErrorText({ id, error }: { id: string; error: string | null }) {
  return error ? (
    <p id={id} role="alert" className="m-0 text-[12px] text-red-600">
      {error}
    </p>
  ) : null;
}

function ApplyRow() {
  return (
    <div className="flex justify-end">
      <Button type="submit" variant="primary" size="sm">
        적용
      </Button>
    </div>
  );
}

// ── text ─────────────────────────────────────────────────────────────────

function TextEditor<T>({ field, filters, onApply }: QuickFilterEditorProps<T>) {
  const id = useId();
  const current = filters.find(
    (cond) => cond.col === field.id && (cond.op === 'has' || cond.op === 'eq'),
  );
  const [op, setOp] = useState<'has' | 'eq'>(current?.op === 'eq' ? 'eq' : 'has');
  const [text, setText] = useState(current && current.op !== 'in' ? current.value : '');
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;

  const submit = () => {
    const rest = withoutColumn(filters, field.id);
    if (!text.trim()) return onApply(rest);
    const valid = validateCondition(
      { col: field.id, op, value: text },
      { [field.id]: field.filter },
    );
    if (!valid) return setError(invalidMessage(field.filter));
    if (rest.length + 1 > FILTER_LIMITS.conditionsMax) return setError(LIMIT_MESSAGE);
    onApply([...rest, valid]);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      onKeyDown={enterSubmits(submit)}
      className="flex flex-col gap-3"
    >
      <div role="group" aria-label="조건" className="flex gap-1.5">
        {(
          [
            ['has', '포함'],
            ['eq', '같음'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={op === value}
            className={chipClass(op === value)}
            onClick={() => setOp(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>값</span>
        <input
          type="text"
          className={FIELD_CLASS}
          value={text}
          maxLength={FILTER_LIMITS.valueMax}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
        />
      </label>
      <ErrorText id={errorId} error={error} />
      <ApplyRow />
    </form>
  );
}

// ── number·date ────────────────────────────────────────────────────────────

function RangeEditor<T>({ field, filters, onApply }: QuickFilterEditorProps<T>) {
  const id = useId();
  const def = field.filter;
  const own = filters.filter((cond) => cond.col === field.id);
  const [min, setMin] = useState(scalarValue(own, 'gte'));
  const [max, setMax] = useState(scalarValue(own, 'lte'));
  const [error, setError] = useState<string | null>(null);

  const errorId = `${id}-error`;
  const describedBy = error ? errorId : undefined;

  const submit = () => {
    const range = rangeConditions(field.id, def, min, max);
    if (typeof range === 'string') return setError(range);
    const next = [...withoutColumn(filters, field.id), ...range];
    if (next.length > FILTER_LIMITS.conditionsMax) return setError(LIMIT_MESSAGE);
    onApply(next);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const presetRange = def.kind === 'date' ? datePresetRange : null;
  const gte = scalarValue(own, 'gte');
  const lte = scalarValue(own, 'lte');

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      onKeyDown={enterSubmits(submit)}
      className="flex flex-col gap-3"
    >
      {presetRange ? (
        <div role="group" aria-label="빠른 기간" className="flex flex-wrap gap-1.5">
          {DATE_PRESETS.map((preset) => {
            const range = presetRange(preset.id);
            const pressed = gte === range.from && lte === range.to;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={pressed}
                className={chipClass(pressed)}
                onClick={() => {
                  const conds = rangeConditions(field.id, def, range.from, range.to);
                  if (typeof conds === 'string') return setError(conds);
                  const next = [...withoutColumn(filters, field.id), ...conds];
                  if (next.length > FILTER_LIMITS.conditionsMax) return setError(LIMIT_MESSAGE);
                  onApply(next);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL_CLASS}>{def.kind === 'date' ? '시작일' : '최소'}</span>
          <input
            type={def.kind === 'date' ? 'date' : 'text'}
            inputMode={def.kind === 'date' ? undefined : 'decimal'}
            className={FIELD_CLASS}
            value={min}
            aria-describedby={describedBy}
            onChange={(event) => {
              setMin(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL_CLASS}>{def.kind === 'date' ? '종료일' : '최대'}</span>
          <input
            type={def.kind === 'date' ? 'date' : 'text'}
            inputMode={def.kind === 'date' ? undefined : 'decimal'}
            className={FIELD_CLASS}
            value={max}
            aria-describedby={describedBy}
            onChange={(event) => {
              setMax(event.target.value);
              setError(null);
            }}
          />
        </label>
      </div>
      <ErrorText id={errorId} error={error} />
      <ApplyRow />
    </form>
  );
}
