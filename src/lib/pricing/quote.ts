/**
 * 견적 계산 순수 함수 (§4.5.7 금액 규칙, AC-60). 서버(저장 시 재계산)와 클라이언트(STEP6·장바구니)가 같은 함수를 쓴다.
 *
 *  - preDiscount = (basePrice + Σparts + Σbundles) × qty
 *  - discountAmt = preDiscount × rate/100
 *  - lineTotal   = floor((preDiscount − discountAmt) / 1000) × 1000, 최소 0
 *  - 목표금액 역산: rate = clamp((1 − target/preDiscount) × 100, 0, 100), 소수 1자리 반올림
 *  - 통화 혼합 금지: 라인 통화가 다르면 합계 대신 통화별 소계
 */
export const THOUSAND = 1000;

export type PricedOption = { itemCode: string; itemName: string; unitPrice: number };

export type QuoteLineInput = {
  basePrice: number;
  parts?: readonly PricedOption[];
  bundles?: readonly PricedOption[];
  qty: number;
  /** 할인율 % (0~100) */
  discountRate: number;
  /** 통화. 1,000원 절삭은 KRW 에만 적용하고 다른 통화는 소수 2자리 반올림 (기본 KRW) */
  currency?: string;
};

export const FLOOR_CURRENCY = 'KRW';

/** 통화별 라인 금액 정리: KRW 는 1,000원 절삭, 그 외는 소수 2자리 반올림 (최소 0) */
export function settleAmount(amount: number, currency: string = FLOOR_CURRENCY): number {
  if (currency === FLOOR_CURRENCY) return floorToThousand(amount);
  return Math.max(0, Math.round(amount * 100) / 100);
}

export type QuoteLineAmounts = {
  preDiscount: number;
  discountAmount: number;
  lineTotal: number;
};

export function floorToThousand(amount: number): number {
  return Math.max(0, Math.floor(amount / THOUSAND) * THOUSAND);
}

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.min(100, Math.max(0, rate));
}

/** 소수 1자리 반올림 (역산 결과·슬라이더 표시용) */
export function roundRate(rate: number): number {
  return Math.round(clampRate(rate) * 10) / 10;
}

function sumOptions(options: readonly PricedOption[] | undefined): number {
  return (options ?? []).reduce((sum, option) => sum + option.unitPrice, 0);
}

/** 옵션 포함 단가 (수량 곱하기 전) */
export function unitWithOptions(input: Pick<QuoteLineInput, 'basePrice' | 'parts' | 'bundles'>) {
  return input.basePrice + sumOptions(input.parts) + sumOptions(input.bundles);
}

export function computeLine(input: QuoteLineInput): QuoteLineAmounts {
  const qty = Math.max(0, Math.floor(input.qty));
  const preDiscount = unitWithOptions(input) * qty;
  const discountAmount = preDiscount * (clampRate(input.discountRate) / 100);
  return {
    preDiscount,
    discountAmount,
    lineTotal: settleAmount(preDiscount - discountAmount, input.currency),
  };
}

/** 목표 금액으로 할인율 역산. preDiscount 가 0 이하거나 target 이 더 크면 0% */
export function rateFromTarget(target: number, preDiscount: number): number {
  if (!(preDiscount > 0) || !Number.isFinite(target)) return 0;
  return roundRate((1 - target / preDiscount) * 100);
}

export type CartLineAmount = { currency: string; lineTotal: number };

export type CartTotals = {
  /** 통화별 소계 (통화 코드 오름차순) */
  subtotals: { currency: string; amount: number }[];
  /** 통화가 하나일 때만 단일 합계, 혼합이면 null (AC-65) */
  total: number | null;
  currency: string | null;
  count: number;
};

export function cartTotals(lines: readonly CartLineAmount[]): CartTotals {
  const byCurrency = new Map<string, number>();
  for (const line of lines) {
    byCurrency.set(line.currency, (byCurrency.get(line.currency) ?? 0) + line.lineTotal);
  }
  const subtotals = [...byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const single = subtotals.length === 1 ? subtotals[0]! : null;
  return {
    subtotals,
    total: single ? single.amount : null,
    currency: single ? single.currency : null,
    count: lines.length,
  };
}

export type GroupItemSelection = { unitPrice: number; qty: number; checked: boolean };

/** 그룹 소계 = 하드웨어 단가 + Σ(체크된 항목 단가 × 수량) (§4.5.7 그룹 솔루션) */
export function groupSubtotal(hardwarePrice: number, items: readonly GroupItemSelection[]): number {
  return items
    .filter((item) => item.checked)
    .reduce((sum, item) => sum + item.unitPrice * Math.max(1, item.qty), hardwarePrice);
}
