/**
 * 월 키(`YYYY-MM`) 순수 헬퍼 — 서버·클라이언트 공용 (월 범위 슬라이더·조달 차트). 서버 조회 계층(server/procurement/shared.ts)의
 * 월 키와 같은 형식이다. 날짜 객체·시간대를 쓰지 않는다(문자열 산술).
 */
export type MonthKey = string;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): boolean {
  return MONTH_RE.test(value);
}

export function parseMonthKey(value: MonthKey): { year: number; month: number } {
  const match = MONTH_RE.exec(value);
  if (!match) throw new RangeError(`월 형식이 아닙니다 (YYYY-MM): ${value}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function toMonthKey(year: number, month: number): MonthKey {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** n 달 뒤(음수면 앞) */
export function shiftMonth(value: MonthKey, n: number): MonthKey {
  const { year, month } = parseMonthKey(value);
  const index = year * 12 + (month - 1) + n;
  return toMonthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** from..to (양 끝 포함) 월 목록. from > to 면 빈 배열 */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  parseMonthKey(from);
  parseMonthKey(to);
  const months: MonthKey[] = [];
  for (let current = from; current <= to; current = shiftMonth(current, 1)) months.push(current);
  return months;
}

/** `2025.03` — 슬라이더 범위 표시 */
export function formatMonthDot(value: MonthKey): string {
  return value.replace('-', '.');
}

/** `25.03` — 좁은 축 라벨 */
export function formatMonthShort(value: MonthKey): string {
  return formatMonthDot(value).slice(2);
}

/** `2025년 3월` — 툴팁 제목·aria-valuetext·요약 문장 */
export function formatMonthLong(value: MonthKey): string {
  const { year, month } = parseMonthKey(value);
  return `${year}년 ${month}월`;
}

/** 정렬된 월 목록에서 value 의 칸 — 없으면 가장 가까운 칸(목록 밖이면 양 끝). 빈 목록이면 0 */
export function nearestMonthIndex(months: readonly MonthKey[], value: MonthKey): number {
  if (months.length === 0) return 0;
  const exact = months.indexOf(value);
  if (exact >= 0) return exact;
  const after = months.findIndex((month) => month > value);
  if (after < 0) return months.length - 1;
  return Math.max(0, after === 0 ? 0 : after - 1);
}
