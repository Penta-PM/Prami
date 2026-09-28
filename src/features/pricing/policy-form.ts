/** 등록·수정 모달 폼 상태 (문자열 입력값) ↔ Action 입력 변환 */
export type PolicyFormValues = {
  productFamily: string;
  itemCode: string;
  itemName: string;
  spec: string;
  unit: string;
  priceType: string;
  priceCategory: string;
  currency: string;
  hasCorePrice: boolean;
  unitPrice: string;
  remark: string;
  effectiveFrom: string;
  appliesToAllCustomers: boolean;
  baseCoreCount: string;
  unitPricePerCore: string;
  customerCode: string;
  customerNo: string;
  customerName: string;
  reason: string;
};

export const EMPTY_POLICY_FORM: PolicyFormValues = {
  productFamily: '',
  itemCode: '',
  itemName: '',
  spec: '',
  unit: 'EA',
  priceType: '정상판매',
  priceCategory: '일반',
  currency: 'KRW',
  hasCorePrice: false,
  unitPrice: '',
  remark: '',
  effectiveFrom: '',
  appliesToAllCustomers: false,
  baseCoreCount: '0',
  unitPricePerCore: '0',
  customerCode: '0',
  customerNo: '',
  customerName: '',
  reason: '',
};

type SourceRow = {
  productFamily: string;
  itemCode: string;
  itemName: string;
  spec: string | null;
  unit: string;
  priceType: string | null;
  priceCategory: string;
  currency: string;
  hasCorePrice: boolean;
  unitPrice: string;
  remark: string | null;
  effectiveFrom: string;
  appliesToAllCustomers: boolean;
  baseCoreCount: number;
  unitPricePerCore: string;
  customerCode: string;
  customerNo: string | null;
  customerName: string | null;
};

const amount = (value: string) => String(Number(value));

/** 기존 행 → 폼 값 (수정·복사). 사유는 항상 새로 입력한다 */
export function formFromRow(row: SourceRow): PolicyFormValues {
  return {
    productFamily: row.productFamily,
    itemCode: row.itemCode,
    itemName: row.itemName,
    spec: row.spec ?? '',
    unit: row.unit,
    priceType: row.priceType ?? '',
    priceCategory: row.priceCategory,
    currency: row.currency,
    hasCorePrice: row.hasCorePrice,
    unitPrice: amount(row.unitPrice),
    remark: row.remark ?? '',
    effectiveFrom: row.effectiveFrom,
    appliesToAllCustomers: row.appliesToAllCustomers,
    baseCoreCount: String(row.baseCoreCount),
    unitPricePerCore: amount(row.unitPricePerCore),
    customerCode: row.customerCode,
    customerNo: row.customerNo ?? '',
    customerName: row.customerName ?? '',
    reason: '',
  };
}

/** 폼 값 → Action 입력 (숫자 변환은 서버 zod 가 검증) */
export function formToInput(values: PolicyFormValues) {
  return {
    ...values,
    unitPrice: values.unitPrice,
    baseCoreCount: values.baseCoreCount || '0',
    unitPricePerCore: values.unitPricePerCore || '0',
  };
}
