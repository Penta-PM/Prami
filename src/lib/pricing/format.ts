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
