/**
 * ERP 품목대분류(원문) → 정규화 제품군 (PRAMI-003 §4.2.4). `items.category_major` = `sales_prices.product_family` 값이다.
 * 비교는 대소문자를 구분하는 정확 일치이고, 앞뒤 공백만 제거한다. 대응표에 없는 대분류는 임포트 행 오류(`unknown_major`).
 * 화면·필터·홈 카드·계산기·챗봇은 정규화 값만 쓴다(PRODUCT_CARDS·PRODUCT_FAMILIES 와 같은 값). 원문은 상세 드로어에만.
 */
export const ERP_MAJOR_TO_FAMILY: Readonly<Record<string, string>> = {
  WAPPLES: 'WAPPLES',
  "D'Amo": 'D.AMO',
  'iSIGN+': 'iSIGN',
  'iSIGN+ PKI': 'iSIGN PKI',
  Cloudbric: 'Cloudbric',
};

/** 원문 대분류 → 정규화 제품군. 대응표에 없으면 null */
export function normalizeErpMajor(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return ERP_MAJOR_TO_FAMILY[raw.trim()] ?? null;
}

/** 정규화 제품군 집합 (대응표의 값) */
export const NORMALIZED_FAMILIES: readonly string[] = [
  ...new Set(Object.values(ERP_MAJOR_TO_FAMILY)),
];
