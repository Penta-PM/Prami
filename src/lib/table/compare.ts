/**
 * 표 정렬 비교 함수 (#32 스펙 §2, Q1 B — 코드포인트, 클라이언트·서버 동일).
 *
 * CLDR 비의존: `Intl.Collator`·`localeCompare` 는 ICU 버전에 따라 순서가 달라지고 서버 `lower(x) COLLATE "C"` 와도
 * 어긋난다. 그래서 ASCII A-Z 만 소문자로 바꾼 뒤 코드포인트로 비교한다 (`lib/date-format.ts` 와 같은 원칙).
 * 그 결과 'WAPPLES-2700' 이 'WAPPLES-300' 보다 앞에 온다 — 사용자가 수용했다.
 */

export type SortDir = 'asc' | 'desc';
export type SortType = 'text' | 'number' | 'date' | 'status' | 'none';
/** 금액은 통화로 먼저 묶고 같은 통화 안에서 금액순 */
export type MoneyValue = { amount: number; currency: string };
export type SortValue = string | number | Date | MoneyValue | null | undefined;

/** 스펙 §2 상태 정의 순서 */
export const STATUS_ORDERS = {
  pricingState: ['운영중', '미사용'],
  partMapping: ['사용', '임시', '폐기', '미확인'],
  auditResult: ['성공', '거부', '오류'],
  role: ['ADMIN', 'USER'],
  /** 사용자 상태: 활성 → 비활성 (#32 스펙 §9 Q1) */
  userStatus: ['active', 'inactive'],
} as const;

/** 표시용 빈 값 표식 (EM DASH U+2014) */
const EMPTY_DASH = '—';

function isMoneyValue(value: SortValue): value is MoneyValue {
  return typeof value === 'object' && value !== null && !(value instanceof Date);
}

/** null·undefined·''·'—'(U+2014)·공백만 → true. NaN 숫자, Invalid Date 도 빈 값 */
export function isEmptySortValue(value: SortValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' || trimmed === EMPTY_DASH;
  }
  if (typeof value === 'number') return Number.isNaN(value);
  if (value instanceof Date) return Number.isNaN(value.getTime());
  return Number.isNaN(value.amount);
}

/** ASCII 대문자(A-Z)만 소문자로 — 서버 `lower()` 를 `COLLATE "C"` 에서 쓴 것과 같은 범위 */
function asciiLower(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

/** ASCII A-Z 만 소문자로 바꾼 뒤 UTF-16 코드 유닛이 아니라 코드포인트 순으로 비교 (Intl.Collator·localeCompare 금지). 음수/0/양수 */
export function compareText(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    // codePointAt 은 서로게이트 쌍을 하나의 코드포인트로 읽는다 — '\u{1F600}' 이 '￿' 보다 뒤에 온다
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(j) as number;
    const diff = asciiLower(ca) - asciiLower(cb);
    if (diff !== 0) return diff;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  // 공통 접두사가 같으면 짧은 쪽이 앞
  return a.length - i - (b.length - j);
}

function compareNumber(a: number, b: number): number {
  // a - b 는 Infinity - Infinity 에서 NaN 이 된다
  return a < b ? -1 : a > b ? 1 : 0;
}

function toTime(value: SortValue): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(String(value)).getTime();
}

function toNumber(value: SortValue): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (isMoneyValue(value)) return value.amount;
  return Number(value);
}

/** 오름차순 비교. 빈 값은 다루지 않는다(호출 전에 걸러짐). status 는 statusOrder 의 인덱스 순, 목록에 없는 값은 목록 뒤에서 compareText 순.
 *  number: 숫자 비교(MoneyValue 면 currency compareText 먼저, 그다음 amount). date: Date | ISO 문자열 → 시각 값. text: compareText(String(v)). */
export function compareSortValues(
  type: SortType,
  a: SortValue,
  b: SortValue,
  statusOrder?: readonly string[],
): number {
  switch (type) {
    case 'none':
      return 0;
    case 'number': {
      // 통화가 섞이면 통화로 먼저 묶는다. 통화 없는 숫자는 통화 있는 값보다 앞(빈 통화 '' 와 같게 취급)
      const ca = isMoneyValue(a) ? a.currency : '';
      const cb = isMoneyValue(b) ? b.currency : '';
      const byCurrency = compareText(ca, cb);
      if (byCurrency !== 0) return byCurrency;
      return compareNumber(toNumber(a), toNumber(b));
    }
    case 'date': {
      const ta = toTime(a);
      const tb = toTime(b);
      // 파싱할 수 없는 문자열은 날짜 뒤에서 문자열 순으로 — 비교가 추이적으로 남도록
      const na = Number.isNaN(ta);
      const nb = Number.isNaN(tb);
      if (na || nb) return na && nb ? compareText(String(a), String(b)) : na ? 1 : -1;
      return compareNumber(ta, tb);
    }
    case 'status': {
      const sa = String(a);
      const sb = String(b);
      const ia = statusOrder?.indexOf(sa) ?? -1;
      const ib = statusOrder?.indexOf(sb) ?? -1;
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return compareText(sa, sb);
    }
    case 'text':
      return compareText(String(a), String(b));
  }
}

/** 새 배열을 반환하는 stable 정렬. 빈 값은 dir 과 관계없이 항상 맨 뒤(원래 순서 유지). dir 'desc' 는 비교 결과만 뒤집는다(같은 값끼리는 여전히 원래 순서). type 'none' 이면 복사본 그대로. */
export function sortRows<T>(
  rows: readonly T[],
  getValue: (row: T) => SortValue,
  type: SortType,
  dir: SortDir,
  statusOrder?: readonly string[],
): T[] {
  if (type === 'none') return rows.slice();
  const sign = dir === 'desc' ? -1 : 1;
  const filled: { row: T; value: SortValue }[] = [];
  const empty: T[] = [];
  for (const row of rows) {
    const value = getValue(row);
    if (isEmptySortValue(value)) empty.push(row);
    else filled.push({ row, value });
  }
  // Array.prototype.sort 는 ES2019 부터 stable 이다 — 같은 값은 원래 순서 유지
  filled.sort((x, y) => sign * compareSortValues(type, x.value, y.value, statusOrder));
  return [...filled.map((entry) => entry.row), ...empty];
}
