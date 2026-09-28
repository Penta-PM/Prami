/**
 * 순매출 계산 순수 함수 (§4.5.5 순매출 계산기, PR-7 화면에서 사용).
 * 금액은 소수 2자리 문자열(numeric)로 다룬다. 원가가 없으면 원가·이익·이익률을 계산하지 않는다.
 */
export type NetSalesInput = {
  sellingPrice: number;
  quantity: number;
  /** 할인율 (%, 0~100) */
  discountRate?: number;
  unitCost?: number | null;
};

export type NetSalesResult = {
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
  /** 원가 입력이 있을 때만 (ADMIN) */
  cost?: { totalCost: string; profit: string; marginRate: string };
};

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

export function computeNetSales(input: NetSalesInput): NetSalesResult {
  const rate = Math.min(100, Math.max(0, input.discountRate ?? 0));
  const gross = input.sellingPrice * input.quantity;
  const discount = gross * (rate / 100);
  const net = gross - discount;
  const result: NetSalesResult = {
    grossAmount: money(gross),
    discountAmount: money(discount),
    netAmount: money(net),
  };
  if (input.unitCost === undefined || input.unitCost === null) return result;
  const totalCost = input.unitCost * input.quantity;
  const profit = net - totalCost;
  return {
    ...result,
    cost: {
      totalCost: money(totalCost),
      profit: money(profit),
      marginRate: net === 0 ? '0.0' : (Math.round((profit / net) * 1000) / 10).toFixed(1),
    },
  };
}
