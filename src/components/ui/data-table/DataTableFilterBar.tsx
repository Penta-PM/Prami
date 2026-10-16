'use client';

import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';
import {
  describeCondition,
  FILTER_LIMITS,
  groupConditions,
  isMoneyRangeActive,
  OP_ORDER,
  validateCondition,
  withoutColumn,
  type ColumnFilterDef,
  type FilterCondition,
  type ScalarFilterOp,
} from '@/lib/table/filter';

import { Button } from '../button';
import { chipClass } from '../chip';
import { Popover } from '../popover';
import { applyFilterFields, type DataTableFilterField } from './filter-fields';

export type DataTableFilterBarProps<T> = {
  /** 필터할 수 있는 필드(열 정의 순서). filterFieldsOf(columns, extra) */
  fields: readonly DataTableFilterField<T>[];
  filters: readonly FilterCondition[];
  /** 조건 변경 — 적용·칩 × 에서 부른다 (키 입력마다 부르지 않는다) */
  onFiltersChange: (next: readonly FilterCondition[]) => void;
  /** '필터 초기화' — 열 필터 + 그 화면의 기존 필터 + 정렬 해제 (스펙 §2.5-4). '열 초기화'(너비·순서)와 별개 */
  onReset: () => void;
  /** 정렬이 기본값이 아닌지 — '필터 초기화' 노출 조건에 들어간다 */
  sorted?: boolean;
  /**
   * '필터 초기화' 를 보일지. 기본: 열 필터 또는 정렬이 기본값이 아닐 때(Plan 결정 Q1 B — 초기화가 정렬까지 해제하므로
   * 노출 조건도 같게, 클라이언트·서버 표 공통). 서버 표는 그 화면의 기존 필터(분류·기간·검색)가 있을 때도 true 로 넘긴다
   */
  canReset?: boolean;
  /** 클라이언트 표의 전체 행 — 넘기면 필터가 있을 때 "전체 N건 중 M건" 을 보인다. 서버 표는 생략(기존 total 표시) */
  rows?: readonly T[];
  /** 툴바 끝의 안내 문구 (예: "최근 100건 안에서 필터합니다") */
  note?: ReactNode;
  className?: string;
};

const OP_LABELS: Record<ScalarFilterOp, string> = {
  has: '포함',
  eq: '같음',
  gte: '이상',
  lte: '이하',
};

const LABEL_CLASS = 'text-[12px] font-semibold text-text-secondary';
const FIELD_CLASS =
  'w-full rounded-lg border-0 bg-gray-75 px-3 py-2 text-[13px] text-ink-900 shadow-(--hairline-default) outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--purple-500)] disabled:cursor-not-allowed disabled:opacity-50';

/**
 * 표 위 열 필터 툴바 (표 열 필터 스펙 §2.5-1·2·6). 클라이언트·서버 표 공용 — 조건은 호출자가 소유한다
 * (클라이언트 표: useUrlFilters / 모달: useStateFilters, 서버 표: URL → 서버 파싱).
 *
 * "＋ 필터" → 열 선택 → 연산자·값 팝오버(`<열> 필터`) → "적용"(Enter) 으로 확정. 적용된 조건은 열마다 칩 하나
 * (`<열>: <조건>` + × "<열> 필터 해제"), 끝에 "필터 초기화". 칩 바는 줄바꿈한다.
 */
export function DataTableFilterBar<T>({
  fields,
  filters,
  onFiltersChange,
  onReset,
  sorted = false,
  canReset,
  rows,
  note,
  className,
}: DataTableFilterBarProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /** null = 열 선택 단계, 아니면 편집 중인 필드 id */
  const [editing, setEditing] = useState<string | null>(null);

  const byId = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const groups = useMemo(
    () => groupConditions(filters).filter((group) => byId.has(group.col)),
    [filters, byId],
  );
  // 선택지가 없는 enum(예: 통화가 하나도 없는 목록)은 고를 수 없다
  const choosable = fields.filter(
    (field) => field.filter.kind !== 'enum' || field.filter.options.length > 0,
  );
  const editingField = editing ? byId.get(editing) : undefined;

  const visibleCount = useMemo(
    () => (rows && filters.length > 0 ? applyFilterFields(rows, filters, fields).length : null),
    [rows, filters, fields],
  );

  const focusTrigger = () => triggerRef.current?.focus();
  const close = () => {
    setOpen(false);
    setEditing(null);
  };

  // 칩·URL 순서를 필드(열 정의) 순 → 연산자 순으로 맞춘다 — URL 파싱 결과(parseFilterParams)와 같은 순서
  const ordered = (conds: readonly FilterCondition[]) => {
    const index = (col: string) => fields.findIndex((field) => field.id === col);
    return [...conds].sort(
      (a, b) => index(a.col) - index(b.col) || OP_ORDER.indexOf(a.op) - OP_ORDER.indexOf(b.op),
    );
  };

  const apply = (next: readonly FilterCondition[]) => {
    onFiltersChange(ordered(next));
    close();
    focusTrigger();
  };

  const showReset = canReset ?? (filters.length > 0 || sorted);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button
        ref={triggerRef}
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else {
            setEditing(null);
            setOpen(true);
          }
        }}
      >
        ＋ 필터
      </Button>

      <Popover
        // 단계가 바뀌면 새 팝오버로 다시 열어 그 단계의 첫 입력으로 포커스한다
        key={editing ?? '__columns'}
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        anchorRef={triggerRef}
        label={editingField ? `${editingField.label} 필터` : '필터할 열 선택'}
      >
        {editingField ? (
          <FilterEditor
            field={editingField}
            filters={filters}
            onApply={(conds) => apply([...withoutColumn(filters, editingField.id), ...conds])}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <p className={cn('m-0 mb-1', LABEL_CLASS)}>필터할 열</p>
            {choosable.map((field) => {
              const active = filters.some((cond) => cond.col === field.id);
              return (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => setEditing(field.id)}
                  className="flex w-full items-center justify-between rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-ink-900 hover:bg-gray-75 focus-visible:outline-2 focus-visible:outline-purple-500"
                >
                  {field.label}
                  {active ? (
                    <span className="text-[11px] font-semibold text-purple-600">적용 중</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </Popover>

      {groups.length > 0 ? (
        <ul
          aria-label="적용된 필터"
          className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0"
        >
          {groups.map((group) => {
            const field = byId.get(group.col) as DataTableFilterField<T>;
            const inactive =
              field.filter.kind === 'money' && !isMoneyRangeActive(filters, field.filter);
            return (
              <li
                key={group.col}
                className={cn(chipClass(false), 'inline-flex items-center gap-1 py-[5px] pr-1.5')}
              >
                <span>
                  {describeCondition(group.conds, field.label, field.filter)}
                  {inactive ? (
                    <span className="font-normal text-text-tertiary"> (통화 선택 시 적용)</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-label={`${field.label} 필터 해제`}
                  onClick={() => {
                    onFiltersChange(withoutColumn(filters, group.col));
                    focusTrigger();
                  }}
                  className="inline-flex size-5 items-center justify-center rounded-full border-0 bg-transparent text-[14px] leading-none text-text-tertiary hover:bg-gray-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-purple-500"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {showReset ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onReset();
            close();
            // 버튼이 사라지므로 포커스를 '＋ 필터' 로 옮긴다
            focusTrigger();
          }}
        >
          필터 초기화
        </Button>
      ) : null}

      {note ? <span className="text-[12px] text-text-tertiary">{note}</span> : null}

      {rows && visibleCount !== null ? (
        <span className="ml-auto text-[12px] font-semibold text-text-tertiary">
          전체 {rows.length}건 중 {visibleCount}건
        </span>
      ) : null}
    </div>
  );
}

/** 필터 결과 0건 빈 상태 (스펙 §2.5-7). 데이터 자체가 없을 때의 "등록된 … 없습니다" 와 구분한다 */
export function DataTableFilterEmpty({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="m-0 text-[13px] text-text-tertiary">조건에 맞는 결과가 없습니다</p>
      <Button size="sm" onClick={onReset}>
        필터 초기화
      </Button>
    </div>
  );
}

// ── 편집 팝오버 내용 ──────────────────────────────────────────────────────

type FilterEditorProps<T> = {
  field: DataTableFilterField<T>;
  filters: readonly FilterCondition[];
  onApply: (conds: FilterCondition[]) => void;
};

function scalarValue(conds: readonly FilterCondition[], op: ScalarFilterOp): string {
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

function FilterEditor<T>({ field, filters, onApply }: FilterEditorProps<T>) {
  const id = useId();
  const def = field.filter;
  const current = filters.filter((cond) => cond.col === field.id);
  const firstScalar = current.find((cond) => cond.op === 'has' || cond.op === 'eq');

  const [op, setOp] = useState<ScalarFilterOp>(
    firstScalar && firstScalar.op !== 'in' ? firstScalar.op : 'has',
  );
  const [text, setText] = useState(firstScalar && firstScalar.op !== 'in' ? firstScalar.value : '');
  const [checked, setChecked] = useState<readonly string[]>(
    current.find((cond) => cond.op === 'in')?.values ?? [],
  );
  const [min, setMin] = useState(scalarValue(current, 'gte'));
  const [max, setMax] = useState(scalarValue(current, 'lte'));
  const [error, setError] = useState<string | null>(null);

  /** 통화가 섞이는 금액 열은 통화 조건이 하나로 정해졌을 때만 범위를 받는다 (§2.1-2) */
  const moneyLocked = def.kind === 'money' && !isMoneyRangeActive(filters, def);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const candidates = (): FilterCondition[] => {
    switch (def.kind) {
      case 'text':
        return text.trim() ? [{ col: field.id, op, value: text }] : [];
      case 'enum':
        return checked.length > 0 ? [{ col: field.id, op: 'in', values: [...checked] }] : [];
      default: {
        const lo = def.kind === 'date' ? min : normalizeNumber(min);
        const hi = def.kind === 'date' ? max : normalizeNumber(max);
        const out: FilterCondition[] = [];
        if (lo.trim()) out.push({ col: field.id, op: 'gte', value: lo });
        if (hi.trim()) out.push({ col: field.id, op: 'lte', value: hi });
        return out;
      }
    }
  };

  const submit = () => {
    if (moneyLocked) return;
    const defs = { [field.id]: def };
    const conds: FilterCondition[] = [];
    for (const candidate of candidates()) {
      const valid = validateCondition(candidate, defs);
      if (!valid) return setError(invalidMessage(def));
      conds.push(valid);
    }
    const lo = conds.find((cond) => cond.op === 'gte');
    const hi = conds.find((cond) => cond.op === 'lte');
    if (lo && hi && lo.op === 'gte' && hi.op === 'lte') {
      const reversed =
        def.kind === 'date' ? lo.value > hi.value : Number(lo.value) > Number(hi.value);
      if (reversed)
        return setError(
          def.kind === 'date' ? '시작일이 종료일보다 늦습니다' : '최소값이 최대값보다 큽니다',
        );
    }
    if (withoutColumn(filters, field.id).length + conds.length > FILTER_LIMITS.conditionsMax)
      return setError(`조건은 최대 ${FILTER_LIMITS.conditionsMax}개까지 걸 수 있습니다`);
    onApply(conds);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  // Enter = 적용 — 체크박스·select 는 브라우저의 암묵적 제출이 없으므로 직접 처리한다. 한글 조합 중 Enter 는 무시
  const onKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT') return;
    event.preventDefault();
    submit();
  };

  const describedBy =
    [moneyLocked ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <form noValidate onSubmit={onSubmit} onKeyDown={onKeyDown} className="flex flex-col gap-3">
      {def.kind === 'text' ? (
        <>
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>조건</span>
            <select
              className={FIELD_CLASS}
              value={op}
              onChange={(event) => setOp(event.target.value as ScalarFilterOp)}
            >
              {(['has', 'eq'] as const).map((value) => (
                <option key={value} value={value}>
                  {OP_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>값</span>
            <input
              type="text"
              className={FIELD_CLASS}
              value={text}
              maxLength={FILTER_LIMITS.valueMax}
              aria-describedby={describedBy}
              onChange={(event) => {
                setText(event.target.value);
                setError(null);
              }}
            />
          </label>
        </>
      ) : def.kind === 'enum' ? (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" aria-describedby={describedBy}>
          <legend className={cn('mb-1 p-0', LABEL_CLASS)}>{field.label}</legend>
          {def.options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-[13px] text-ink-900">
              <input
                type="checkbox"
                className="size-4 accent-purple-600"
                checked={checked.includes(option.value)}
                onChange={(event) => {
                  setError(null);
                  setChecked((prev) =>
                    event.target.checked
                      ? // 정의 순서(statusOrder·options 순)로 유지
                        def.options
                          .map((item) => item.value)
                          .filter((value) => value === option.value || prev.includes(value))
                      : prev.filter((value) => value !== option.value),
                  );
                }}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="flex flex-col gap-2">
          {moneyLocked ? (
            <p id={hintId} className="m-0 text-[12px] font-semibold text-text-secondary">
              통화를 먼저 선택하세요
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>{def.kind === 'date' ? '시작일' : '최소'}</span>
              <input
                type={def.kind === 'date' ? 'date' : 'text'}
                inputMode={def.kind === 'date' ? undefined : 'decimal'}
                className={FIELD_CLASS}
                value={min}
                disabled={moneyLocked}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setMin(event.target.value);
                  setError(null);
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>{def.kind === 'date' ? '종료일' : '최대'}</span>
              <input
                type={def.kind === 'date' ? 'date' : 'text'}
                inputMode={def.kind === 'date' ? undefined : 'decimal'}
                className={FIELD_CLASS}
                value={max}
                disabled={moneyLocked}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setMax(event.target.value);
                  setError(null);
                }}
              />
            </label>
          </div>
        </div>
      )}

      {error ? (
        <p id={errorId} role="alert" className="m-0 text-[12px] text-red-500">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={moneyLocked}>
          적용
        </Button>
      </div>
    </form>
  );
}
