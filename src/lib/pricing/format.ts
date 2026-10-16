/**
 * 판매가 표시 (§4.5.3): KRW `12,000,000원`, 그 외 통화 `126 USD` / `168,000 JPY`.
 * DB numeric 은 문자열로 온다 — 소수점이 00 이면 정수로 보인다.
 */
const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

export function formatAmount(amount: string | number): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  return Number.isFinite(value) ? numberFormat.format(value) : String(amount);
}

export function priceLabel(amount: string | number, currency: string): string {
  const formatted = formatAmount(amount);
  return currency.trim().toUpperCase() === 'KRW' ? `${formatted}원` : `${formatted} ${currency}`;
}

/** 단가유형 NULL 은 `—` (R-5, Q-11) */
export function priceTypeLabel(priceType: string | null): string {
  return priceType ?? '—';
}

export type PriceChangeDisplay =
  | { kind: 'none' }
  | { kind: 'same'; text: '변동 없음' }
  | { kind: 'up' | 'down'; arrow: '▲' | '▼'; text: string };

/**
 * 가격 변동 표시 (cost-ratio-price-change §2.4). rate = 서버가 소수 1자리로 반올림한 변동률(%).
 * - 직전 없음·직전가 0(rate null) → '—'
 * - 직전가와 판매가가 같으면 '변동 없음'
 * - 다르면 방향은 금액 비교로 정한다: 반올림이 0.0 이어도 `▲ 이전 대비 0.0% 상승`(값이 실제로 바뀌었음을 숨기지 않는다)
 */
export function priceChangeDisplay(
  unitPrice: string,
  previousPrice: string | null,
  rate: number | null,
): PriceChangeDisplay {
  if (previousPrice === null || rate === null || !Number.isFinite(rate)) return { kind: 'none' };
  const current = Number(unitPrice);
  const previous = Number(previousPrice);
  if (current === previous) return { kind: 'same', text: '변동 없음' };
  const up = current > previous;
  const value = Math.abs(rate).toFixed(1);
  return up
    ? { kind: 'up', arrow: '▲', text: `이전 대비 ${value}% 상승` }
    : { kind: 'down', arrow: '▼', text: `이전 대비 ${value}% 하락` };
}
