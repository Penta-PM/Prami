/**
 * 홈 제품 바로가기 카드 (§4.5.4, 디자인 PRODUCTS). `iSIGN PKI` 는 iSIGN 카드로 묶고 조회 화면의 대분류에서만
 * 별도 값으로 구분한다 (§11 Q-10). 카드 → `/pricing?major=…`.
 */
export type ProductCard = {
  id: string;
  name: string;
  /** 조회 화면 대분류 값 (sales_prices.product_family) */
  major: string;
  accent: string;
  accentSoft: string;
};

export const PRODUCT_CARDS: readonly ProductCard[] = [
  { id: 'wapples', name: 'WAPPLES', major: 'WAPPLES', accent: '#D6428F', accentSoft: '#FCE0F1' },
  { id: 'damo', name: 'D.AMO', major: 'D.AMO', accent: '#6E62E8', accentSoft: '#E3E0FB' },
  { id: 'isign', name: 'iSIGN', major: 'iSIGN', accent: '#B8941F', accentSoft: '#FBF0B8' },
  {
    id: 'cloudbric',
    name: 'Cloudbric',
    major: 'Cloudbric',
    accent: '#2A8FD6',
    accentSoft: '#D3ECFB',
  },
];

export function productCardHref(card: ProductCard): string {
  return `/pricing?major=${encodeURIComponent(card.major)}`;
}
