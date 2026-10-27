/**
 * 조달 금액·비율 표기 (조달이 통합 D-3). 순수 모듈 — 서버·클라이언트 공용. 금액은 원 단위 정수(DB bigint, number 모드).
 *
 * - 표: 백만원 소수 1자리(`1,234.5`), 단위는 열 머리글에 한 번(`납품금액 (백만원)`) — 칸에는 단위를 붙이지 않는다.
 * - KPI·툴팁·요약: 억·만(`12억 3,400만`) — 만 미만은 반올림. 1만 미만(0 제외)은 원 그대로(`5,000원`).
 * - 값 없음(null·NaN) = `—`. 음수는 앞에 `-`.
 */
export const EMPTY_VALUE = '—';

export const MILLION_WON_UNIT = '백만원';

const millionFormat = new Intl.NumberFormat('ko-KR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const integerFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('ko-KR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function isNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 표 열 머리글 — `납품금액 (백만원)` */
export function millionWonHeader(label: string): string {
  return `${label} (${MILLION_WON_UNIT})`;
}

/** 표 칸: 원 → 백만원 소수 1자리 (`123,456,789` → `123.5`). -0.0 은 `0.0` */
export function formatMillionWon(won: number | null | undefined): string {
  if (!isNumber(won)) return EMPTY_VALUE;
  const millions = Math.round(won / 100_000) / 10;
  return millionFormat.format(millions === 0 ? 0 : millions);
}

/** KPI·툴팁: 원 → 억·만 (`1,234,000,000` → `12억 3,400만`, `100,000,000` → `1억`, `34,000,000` → `3,400만`) */
export function formatEokMan(won: number | null | undefined): string {
  if (!isNumber(won)) return EMPTY_VALUE;
  if (won === 0) return '0원';
  const sign = won < 0 ? '-' : '';
  const abs = Math.abs(won);
  if (abs < 10_000) return `${sign}${integerFormat.format(Math.round(abs))}원`;
  // 만 단위로 먼저 반올림한 뒤 억·만으로 나눈다(9,999.5만 → 1억 으로 올림이 넘어가게)
  const man = Math.round(abs / 10_000);
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  const parts: string[] = [];
  if (eok > 0) parts.push(`${integerFormat.format(eok)}억`);
  if (rest > 0) parts.push(`${integerFormat.format(rest)}만`);
  return `${sign}${parts.join(' ')}`;
}

/** 점유율·비율 (0~1) → `12.3%`. null(분모 0) = `—` */
export function formatShare(ratio: number | null | undefined): string {
  if (!isNumber(ratio)) return EMPTY_VALUE;
  return `${percentFormat.format(ratio * 100)}%`;
}

/** 전년 대비 증감률 (0.123 → `+12.3%`, -0.05 → `-5.0%`, 0 → `0.0%`). 전년 0(null) = `—` */
export function formatChangeRate(rate: number | null | undefined): string {
  if (!isNumber(rate)) return EMPTY_VALUE;
  const percent = Math.round(rate * 1000) / 10;
  if (percent === 0) return '0.0%';
  return `${percent > 0 ? '+' : ''}${percentFormat.format(percent)}%`;
}

/** 건수 (`1,234건`) */
export function formatCount(count: number | null | undefined): string {
  if (!isNumber(count)) return EMPTY_VALUE;
  return `${integerFormat.format(count)}건`;
}
