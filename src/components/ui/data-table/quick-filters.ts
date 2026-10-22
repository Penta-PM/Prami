import { formatDate } from '@/lib/date-format';
import {
  describeConditionBody,
  isMoneyRangeActive,
  selectedCurrency,
  type FilterCondition,
} from '@/lib/table/filter';

import { moneyRangeText, type MoneyRange } from '@/lib/table/money-range';

import type { DataTableFilterField } from './filter-fields';

/**
 * 빠른 필터 바 공용 헬퍼 (표 열 필터 빠른 필터 바 §2.1·§2.2·§2.3). React 없는 순수 모듈.
 */

/**
 * 표별 고정 필드 (§2.2). 나머지 필터 필드는 "＋ N개 더" 안. 값은 각 표의 필터 필드 id(URL `f.<id>.*` 의 id) —
 * 열 정의에서는 `filter: { ...def, quick: true }`(DataTableColumnFilter), 열 밖에서 만든 필드 목록(서버 표 *FilterFields)은
 * withQuickFields(fields, QUICK_FILTER_FIELDS.<표>) 로 표시한다. 권한으로 숨는 필드는 필드 목록에 없으므로 바에도 없다.
 * 사용자별 고정 필드 변경은 비범위(코드 설정).
 */
export const QUICK_FILTER_FIELDS = {
  /** 사용자 — ＋ 더: 이메일·마지막 로그인 */
  users: ['name', 'department', 'role', 'status'],
  /** 공지 관리 — ＋ 더 없음 */
  noticesAdmin: ['title', 'publishedAt', 'authorName', 'isImportant'],
  /** 파츠 매핑 — ＋ 더 없음 */
  partsMapping: ['model'],
  /** 내 견적 목록 — ＋ 더: 견적 번호·금액·통화 */
  myQuotes: ['createdAt', 'productFamily', 'summary'],
  /** 가격 — ＋ 더: 통화·품목상태·비고·(관리) 가격 변동 */
  pricing: ['priceType', 'status', 'price'],
  /** 원가 — ＋ 더: 단위 */
  costs: ['currency', 'cost', 'status'],
  /** 감사 — ＋ 더: 대상·IP */
  audit: ['createdAt', 'actor', 'action', 'result'],
} as const satisfies Record<string, readonly string[]>;

export type QuickFilterTable = keyof typeof QUICK_FILTER_FIELDS;

/** 필드 목록에 고정 표시(quick)를 붙인다 — ids 에 있는 필드만 quick: true, 나머지는 그대로(순서 유지) */
export function withQuickFields<T>(
  fields: readonly DataTableFilterField<T>[],
  ids: readonly string[],
): DataTableFilterField<T>[] {
  return fields.map((field) => (ids.includes(field.id) ? { ...field, quick: true } : field));
}

/** 그 필드에 money 슬라이더 범위를 붙인다 (빠른 필터 바 §7.5) — 다른 필드는 그대로 */
export function withMoneyRanges<T>(
  fields: readonly DataTableFilterField<T>[],
  id: string,
  ranges: readonly MoneyRange[],
): DataTableFilterField<T>[] {
  return fields.map((field) => (field.id === id ? { ...field, ranges } : field));
}

/** 선택지가 없는 enum(예: 통화가 하나도 없는 목록)은 고를 수 없다 */
export function isChoosable<T>(field: DataTableFilterField<T>): boolean {
  return field.filter.kind !== 'enum' || field.filter.options.length > 0;
}

/**
 * 바에 버튼으로 보일 필드(고정 + 조건이 걸린 필드, 필드 순서)와 "＋ N개 더" 안의 필드(나머지 중 고를 수 있는 것).
 * 조건이 걸린 필드는 고를 수 없는 enum 이라도 바에 보인다 — 걸린 조건을 읽고 × 로 풀 수 있어야 한다.
 */
export function splitQuickFields<T>(
  fields: readonly DataTableFilterField<T>[],
  conds: readonly FilterCondition[],
): { bar: DataTableFilterField<T>[]; more: DataTableFilterField<T>[] } {
  const active = new Set(conds.map((cond) => cond.col));
  const bar: DataTableFilterField<T>[] = [];
  const more: DataTableFilterField<T>[] = [];
  for (const field of fields) {
    if (active.has(field.id) || (field.quick && isChoosable(field))) bar.push(field);
    else if (isChoosable(field)) more.push(field);
  }
  return { bar, more };
}

/** 버튼 요약에서 enum 값을 몇 개까지 그대로 보일지 — 넘치면 "+N" */
export const QUICK_SUMMARY_VALUES = 2;

/**
 * 필드 버튼 요약 — `{ text, full }`. text 는 버튼에 보이는 짧은 요약(enum 은 쉼표·넘치면 "+N"),
 * full 은 접근성 이름("{열} 필터, {full} 적용 중")에 쓰는 전체 문구. 조건이 없으면 null.
 * money 는 통화가 하나로 정해졌으면 앞에 통화를 붙이고(통화 필드가 "＋ 더" 안이어도 보이게 — §2.3) 금액은 통화 기호 형식
 * (버튼 compact "KRW ₩130만 이상", 접근성 이름 전체 금액 — §7.5),
 * 통화가 정해지지 않은 범위는 "(통화 선택 시 적용)" 을 덧붙인다(범위가 아직 효과가 없음).
 */
export function summarizeField<T>(
  field: DataTableFilterField<T>,
  conds: readonly FilterCondition[],
): { text: string; full: string } | null {
  const own = conds.filter((cond) => cond.col === field.id);
  if (own.length === 0) return null;
  const def = field.filter;
  const body = describeConditionBody(own, def);
  if (def.kind === 'enum') {
    const values = own.flatMap((cond) => (cond.op === 'in' ? cond.values : []));
    const labels = values.map(
      (value) => def.options.find((option) => option.value === value)?.label ?? value,
    );
    const shown = labels.slice(0, QUICK_SUMMARY_VALUES).join(',');
    const rest = labels.length - QUICK_SUMMARY_VALUES;
    return { text: rest > 0 ? `${shown} +${rest}` : shown, full: body };
  }
  if (def.kind === 'money') {
    const currency = selectedCurrency(conds, def);
    if (currency) {
      // 칩은 compact("KRW ₩130만 이상"), 접근성 이름은 전체 금액("KRW ₩1,300,000 이상") — §7.5
      const bound = (op: 'gte' | 'lte') => {
        const found = own.find((cond) => cond.op === op);
        return found && found.op !== 'in' ? found.value : null;
      };
      const [gte, lte] = [bound('gte'), bound('lte')];
      return {
        text: `${currency} ${moneyRangeText(gte, lte, currency, 'compact')}`,
        full: `${currency} ${moneyRangeText(gte, lte, currency, 'full')}`,
      };
    }
    if (!isMoneyRangeActive(conds, def)) {
      const text = `${body} (통화 선택 시 적용)`;
      return { text, full: text };
    }
  }
  return { text: body, full: body };
}

// ── 날짜 프리셋 (§2.3) ──────────────────────────────────────────────────

export const DATE_PRESETS = [
  { id: 'today', label: '오늘' },
  { id: 'last7', label: '최근 7일' },
  { id: 'last30', label: '최근 30일' },
  { id: 'thisMonth', label: '이번 달' },
] as const;

export type DatePresetId = (typeof DATE_PRESETS)[number]['id'];

/** `YYYY-MM-DD` 에 days 를 더한 날짜 (달력 계산 — 시간대 무관) */
function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 그 달의 마지막 날 `YYYY-MM-DD` */
function monthEnd(day: string): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * 프리셋 → `{ from, to }`(양끝 포함, gte·lte 값). 기준일은 한국 시간 오늘(formatDate — 표 날짜 표시·감사 KST 해석과 같은 달력).
 * 오늘 = 오늘~오늘, 최근 7일 = 오늘 포함 7일, 최근 30일 = 오늘 포함 30일, 이번 달 = 1일~말일.
 */
export function datePresetRange(
  preset: DatePresetId,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = formatDate(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 8)}01`, to: monthEnd(today) };
  }
}
