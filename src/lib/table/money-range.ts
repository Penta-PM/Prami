import { formatAmount } from '@/lib/pricing/format';

/**
 * 판매가·원가 범위 슬라이더의 순수 계산 (빠른 필터 바 §7.5). React 없음 — 서버(범위 쿼리 결과 타입)·클라이언트가 같이 쓴다.
 *
 * - 범위(bounds) = 통화별 표 전체 최소·최대(다른 필터와 무관). minPositive = 0 초과 최소(로그 눈금의 시작).
 * - 칸 0..MONEY_SLIDER_STEPS(200). 칸 0 = 하한 없음(0원 포함) — 상한 핸들이 칸 0 이면 실제 최소.
 *   칸 1..200 = [minPositive, max] 로그 구간, 확정 값은 유효숫자 2자리(하한 내림·상한 올림), 칸 1·200 은 실제 값 그대로.
 * - 양 끝 = 조건 없음: 하한 핸들이 칸 0 이면 gte 없음, 상한 핸들이 칸 200 이면 lte 없음.
 */
export type MoneyRange = {
  currency: string;
  min: number;
  max: number;
  /** 0 초과 최소 — 0 초과 값이 없으면 null */
  minPositive: number | null;
};

/** DB 집계 행(numeric 은 문자열) → MoneyRange (서버 범위 쿼리 공용) */
export function toMoneyRange(row: {
  currency: string;
  min: string | number;
  max: string | number;
  minPositive: string | number | null;
}): MoneyRange {
  return {
    currency: row.currency,
    min: Number(row.min),
    max: Number(row.max),
    minPositive: row.minPositive === null ? null : Number(row.minPositive),
  };
}

export const MONEY_SLIDER_STEPS = 200;

export type MoneyHandle = 'lower' | 'upper';

/** 슬라이더를 그릴 수 있는가 — 행 없음·값 1개뿐이면 문구로 대신한다 */
export type MoneyScaleState =
  { kind: 'empty' } | { kind: 'single'; value: number } | { kind: 'scale'; range: MoneyRange };

export function moneyScaleState(range: MoneyRange | undefined): MoneyScaleState {
  if (!range) return { kind: 'empty' };
  if (range.min === range.max || range.minPositive === null)
    return range.min === range.max
      ? { kind: 'single', value: range.min }
      : // 0 초과 값이 없으면(전부 0·음수) 로그 구간을 만들 수 없다 — 값이 사실상 하나로 본다
        { kind: 'single', value: range.max };
  return { kind: 'scale', range };
}

/**
 * 유효숫자 2자리 반올림 (하한 내림·상한 올림). 반환은 URL 에 그대로 쓰는 10진 문자열(지수 표기 없음).
 * 0 이하는 그대로.
 */
export function roundSignificant(value: number, direction: 'down' | 'up'): string {
  if (!(value > 0)) return plain(value);
  const exp = Math.floor(Math.log10(value));
  const unitExp = exp - 1;
  const scaled = value / 10 ** unitExp;
  // 부동소수 오차(1300 → 12.999…)로 한 칸 어긋나지 않게 작은 여유를 둔다
  const digits = direction === 'down' ? Math.floor(scaled + 1e-9) : Math.ceil(scaled - 1e-9);
  return scaleDecimal(digits, unitExp);
}

/** digits × 10^exp 를 지수 없는 10진 문자열로 */
function scaleDecimal(digits: number, exp: number): string {
  if (exp >= 0) return `${digits}${'0'.repeat(exp)}`;
  const raw = String(digits).padStart(-exp + 1, '0');
  const int = raw.slice(0, raw.length + exp);
  const frac = raw.slice(raw.length + exp).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

/** 숫자 → 지수 없는 10진 문자열 (DB numeric(18,2) 범위 — 소수 2자리까지) */
function plain(value: number): string {
  if (Number.isInteger(value)) return value.toFixed(0);
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/** 칸의 로그 값(반올림 전). 칸 1 = minPositive, 칸 200 = max */
function logValue(step: number, lo: number, hi: number): number {
  const t = (step - 1) / (MONEY_SLIDER_STEPS - 1);
  return lo * (hi / lo) ** t;
}

/**
 * 칸 → 조건 값 (URL 문자열). 하한 칸 0·상한 칸 200 은 조건 없음(null).
 * 상한 칸 0 = 실제 최소, 칸 1·200 = 실제 최소(0 초과)·최대, 그 사이는 로그 + 유효숫자 2자리(하한 내림·상한 올림).
 */
export function stepToValue(step: number, handle: MoneyHandle, range: MoneyRange): string | null {
  const s = clampStep(step);
  if (handle === 'lower' && s === 0) return null;
  if (handle === 'upper' && s === MONEY_SLIDER_STEPS) return null;
  return stepValue(s, handle, range);
}

/** 칸의 금액(10진 문자열) — 양 끝도 실제 값. 조건 없음 판정 없이 표시용으로도 쓴다 */
export function stepValue(step: number, handle: MoneyHandle, range: MoneyRange): string {
  const s = clampStep(step);
  const lo = range.minPositive ?? range.max;
  const hi = range.max;
  if (s === 0) return plain(Math.min(range.min, lo));
  if (s === 1) return plain(lo);
  if (s === MONEY_SLIDER_STEPS) return plain(hi);
  return roundSignificant(logValue(s, lo, hi), handle === 'lower' ? 'down' : 'up');
}

function clampStep(step: number): number {
  return Math.min(MONEY_SLIDER_STEPS, Math.max(0, Math.round(step)));
}

/**
 * URL 값 → 가장 가까운 칸 (옛 URL·범위 밖 값의 핸들 위치). 값 자체는 바꾸지 않는다 — 글자·칩·aria 는 URL 실제 값.
 * 하한: 0 이하 → 칸 0, minPositive 미만 → 칸 1. 상한: 최소 이하 → 칸 0. 최대 이상 → 칸 200.
 */
export function valueToStep(value: number, handle: MoneyHandle, range: MoneyRange): number {
  const lo = range.minPositive ?? range.max;
  const hi = range.max;
  if (!Number.isFinite(value)) return handle === 'lower' ? 0 : MONEY_SLIDER_STEPS;
  if (handle === 'lower' && value <= 0) return 0;
  if (handle === 'upper' && value <= range.min && range.min < lo) return 0;
  if (value <= lo) return 1;
  if (value >= hi) return MONEY_SLIDER_STEPS;
  const t = Math.log(value / lo) / Math.log(hi / lo);
  return clampStep(1 + t * (MONEY_SLIDER_STEPS - 1));
}

/** URL 값이 현재 데이터 범위(최소~최대) 밖인가 */
export function isOutsideRange(value: number, range: MoneyRange): boolean {
  return value < range.min || value > range.max;
}

/** 행에서 통화별 범위를 만든다 (내 견적 목록 — 브라우저 계산). 금액이 숫자로 읽히지 않는 행은 건너뛴다 */
export function moneyRangesOf(
  values: Iterable<{ amount: number; currency: string } | null>,
): MoneyRange[] {
  const byCurrency = new Map<string, MoneyRange>();
  for (const item of values) {
    if (!item || !Number.isFinite(item.amount) || !item.currency) continue;
    const { amount, currency } = item;
    const prev = byCurrency.get(currency);
    const positive = amount > 0 ? amount : null;
    if (!prev) {
      byCurrency.set(currency, { currency, min: amount, max: amount, minPositive: positive });
      continue;
    }
    prev.min = Math.min(prev.min, amount);
    prev.max = Math.max(prev.max, amount);
    if (positive !== null)
      prev.minPositive =
        prev.minPositive === null ? positive : Math.min(prev.minPositive, positive);
  }
  return [...byCurrency.values()].sort((a, b) =>
    a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0,
  );
}

// ── 표시 ─────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  KRW: '₩',
  USD: '$',
  EUR: '€',
  JPY: '¥',
  CNY: '¥',
  GBP: '£',
};

function symbolOf(currency: string | null): string {
  if (!currency) return '';
  return CURRENCY_SYMBOLS[currency.trim().toUpperCase()] ?? '';
}

/** 전체 금액 — 팝오버·aria (예: `₩1,300,000`). 기호 없는 통화는 `1,300 CHF` */
export function moneyFull(value: number | string, currency: string | null): string {
  const symbol = symbolOf(currency);
  const amount = formatAmount(value);
  if (symbol) return `${symbol}${amount}`;
  return currency ? `${amount} ${currency.trim()}` : amount;
}

/** 소수 1자리까지(끝 0 제거) */
function oneDecimal(value: number): string {
  const fixed = (Math.round(value * 10) / 10).toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

/** compact 숫자 — KRW 는 만·억·조, 그 밖은 K·M·B. 1만(1천) 미만은 그대로 */
function compactNumber(value: number, korean: boolean): string {
  const abs = Math.abs(value);
  const units: readonly [number, string][] = korean
    ? [
        [1e12, '조'],
        [1e8, '억'],
        [1e4, '만'],
      ]
    : [
        [1e9, 'B'],
        [1e6, 'M'],
        [1e3, 'K'],
      ];
  for (const [size, suffix] of units) {
    if (abs >= size) return `${value < 0 ? '-' : ''}${oneDecimal(abs / size)}${suffix}`;
  }
  return formatAmount(value);
}

/** compact 금액 — 칩 (예: `₩130만`, `$1.3K`) */
export function moneyCompact(value: number | string, currency: string | null): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const korean = (currency ?? '').trim().toUpperCase() === 'KRW';
  const symbol = symbolOf(currency);
  const amount = compactNumber(n, korean);
  if (symbol) return `${symbol}${amount}`;
  return currency ? `${amount} ${currency.trim()}` : amount;
}

/** 범위 문구 — `A 이상` / `B 이하` / `A ~ B`. 양쪽 다 없으면 '제한 없음' */
export function moneyRangeText(
  gte: string | null,
  lte: string | null,
  currency: string | null,
  format: 'full' | 'compact' = 'full',
): string {
  const f = format === 'full' ? moneyFull : moneyCompact;
  if (gte !== null && lte !== null) return `${f(gte, currency)} ~ ${f(lte, currency)}`;
  if (gte !== null) return `${f(gte, currency)} 이상`;
  if (lte !== null) return `${f(lte, currency)} 이하`;
  return '제한 없음';
}
