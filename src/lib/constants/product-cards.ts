/**
 * 홈 제품 바로가기 카드 (§4.5.4, 디자인 PRODUCTS). `iSIGN PKI` 는 iSIGN 카드로 묶고 조회 화면의 대분류에서만
 * 별도 값으로 구분한다 (§11 Q-10). 카드 → `/pricing?family=…` (r5).
 */
import { productColor } from './product-colors';

export type ProductCard = {
  id: string;
  name: string;
  /** 조회 화면 대분류 값 (sales_prices.product_family) */
  major: string;
  /** 카드로 진입할 때 함께 보여 줄 대분류 (PR-9 QA LOW-1: iSIGN 카드 = iSIGN + iSIGN PKI). 없으면 major 하나 */
  majors?: readonly string[];
  /** 강조색("가격 정책 보기 →" 글자) — CSS 색 값. 글자로 쓰이므로 흰 카드 위 4.5:1 이상 */
  accent: string;
  /** 아이콘 사각형 배경 = 제품 색(Penta 디자인 §13) — CSS 색 값. 위 아이콘은 N900 */
  accentSoft: string;
};

/**
 * 제품 카드 색: "가격 정책 보기 →" 글자는 Primary 600(흰 카드 위 6.35:1 — 파스텔은 글자로 못 씀), 아이콘 사각형 배경은
 * 제품 색(§13, PR-5 의 Primary 50 통일을 대체).
 */
const productCard = (id: string, name: string, rest: Partial<ProductCard> = {}): ProductCard => ({
  id,
  name,
  major: name,
  accent: 'var(--penta-primary-600)',
  accentSoft: productColor(name)!,
  ...rest,
});

export const PRODUCT_CARDS: readonly ProductCard[] = [
  productCard('wapples', 'WAPPLES'),
  productCard('damo', 'D.AMO'),
  productCard('isign', 'iSIGN', { majors: ['iSIGN', 'iSIGN PKI'] }),
  productCard('cloudbric', 'Cloudbric'),
];

/**
 * 스펙 r5 §4.5.4 계약: 홈 카드는 `/pricing?family=<제품군명>` 으로 링크하고, 조회 쿼리는 이 상수로 `family` 를
 * 대분류 집합으로 전개한다 — iSIGN → ['iSIGN','iSIGN PKI'], 나머지는 1:1 (Q-10, PR-9 QA LOW-1).
 */
export const PRODUCT_FAMILY_MAJORS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(PRODUCT_CARDS.map((card) => [card.name, card.majors ?? [card.major]]));

export function productCardHref(card: ProductCard): string {
  return `/pricing?family=${encodeURIComponent(card.name)}`;
}

/** `?family=` → 대분류 목록. 제품군명(iSIGN) 또는 카드 id(isign) 모두 받고, 모르는 값이면 null */
export function productFamilyMajors(family: string | undefined): readonly string[] | null {
  if (!family) return null;
  const key = family.trim().toLowerCase();
  const card = PRODUCT_CARDS.find((entry) => entry.name.toLowerCase() === key || entry.id === key);
  return card ? PRODUCT_FAMILY_MAJORS[card.name]! : null;
}
