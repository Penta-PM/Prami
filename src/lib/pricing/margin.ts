/**
 * 순매출 계산 순수 함수 (§4.5.7 순매출 계산기, PR-7 화면 · PR-5 서버 잠금과 공용).
 *  normal = price×qty, discount = normal×rate, actual = normal − discount,
 *  cost = unitCost×qty (ADMIN 만), net = actual − cost − misc, rate = net/actual
 * 금액은 소수 2자리 문자열(numeric)로 다룬다. 원가가 없으면(USER 잠금) 원가·이익·이익률을 계산하지 않는다.
 */
export type NetSalesInput = {
  sellingPrice: number;
  quantity: number;
  /** 할인율 (%, 0~100) */
  discountRate?: number;
  unitCost?: number | null;
  /** 기타 비용 (총액) */
  miscCost?: number;
};

export type NetSalesResult = {
  /** 정상 판매금액 = 단가 × 수량 */
  grossAmount: string;
  discountAmount: string;
  /** 실제 판매금액 = 정상 − 할인 */
  netAmount: string;
  miscAmount: string;
  /** 원가 입력이 있을 때만 (ADMIN): 원가·순매출(실제 − 원가 − 기타)·이익률(순매출/실제) */
  cost?: { totalCost: string; profit: string; marginRate: string };
};

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

export function computeNetSales(input: NetSalesInput): NetSalesResult {
  const rate = Math.min(100, Math.max(0, input.discountRate ?? 0));
  const gross = input.sellingPrice * input.quantity;
  const discount = gross * (rate / 100);
  const net = gross - discount;
  const misc = Math.max(0, input.miscCost ?? 0);
  const result: NetSalesResult = {
    grossAmount: money(gross),
    discountAmount: money(discount),
    netAmount: money(net),
    miscAmount: money(misc),
  };
  if (input.unitCost === undefined || input.unitCost === null) return result;
  const totalCost = input.unitCost * input.quantity;
  const profit = net - totalCost - misc;
  return {
    ...result,
    cost: {
      totalCost: money(totalCost),
      profit: money(profit),
      marginRate: net === 0 ? '0.0' : (Math.round((profit / net) * 1000) / 10).toFixed(1),
    },
  };
}
