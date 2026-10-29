/**
 * 제품별 칩 색 (Penta 디자인 §13, 사용자 지정): 홈 제품 카드 아이콘 사각형·챗봇 제품 칩·계산기 제품 칩·가격 정책 "제품군" 배지.
 * 색은 배경 전용 파스텔이라 위 글자·아이콘은 항상 `--penta-neutral-900`(PRODUCT_FG_CLASS)으로 쓴다 — text-text-primary 금지.
 * `iSIGN PKI` 는 iSIGN 색, 4개 제품 밖 값은 null(호출부가 기존 중립 스타일을 유지).
 */
export const PRODUCT_COLORS: Readonly<Record<string, string>> = {
  wapples: 'var(--penta-product-wapples)',
  'd.amo': 'var(--penta-product-damo)',
  isign: 'var(--penta-product-isign)',
  'isign pki': 'var(--penta-product-isign)',
  cloudbric: 'var(--penta-product-cloudbric)',
};

/** 제품 색 위 글자·아이콘 — 고정 N900 */
export const PRODUCT_FG_CLASS = 'text-neutral-900';

/** 제품명(대소문자·앞뒤 공백 무시) → 배경 CSS 색 값. 4개 제품(+iSIGN PKI) 밖이면 null */
export function productColor(name: string | null | undefined): string | null {
  if (!name) return null;
  return PRODUCT_COLORS[name.trim().toLowerCase()] ?? null;
}
