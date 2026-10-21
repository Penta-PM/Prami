import { computeLine } from '@/lib/pricing/quote';

import type { CartDraft } from '@/lib/page-state/drafts';

import type { CartLine, CartLineInput, SavedQuoteView } from './types';

/**
 * 장바구니 상태 (§4.5.7): useReducer. 라인 금액은 담을 때 순수 함수로 계산해 두고, 저장 시 서버가 같은 함수로 다시 계산한다.
 * 새로고침·재접속 유지는 서버 입력 초안 `cart`(page-state-memory §2.4-6)가 맡는다 — 브라우저 저장소에는 두지 않는다.
 */

/**
 * 예전 sessionStorage 장바구니 키 (page-state-memory §2.4-6 결함 수정). 사용자 구분·검증 없이 저장돼 같은 탭에서 계정을 바꾸면
 * 이전 사용자 장바구니가 보였다 — 다른 사용자 데이터일 수 있어 **이전하지 않고 지운다**.
 */
export const LEGACY_CART_STORAGE_KEY = 'prami.quote.cart.v1';

export type CartState = { lines: CartLine[] };

export type CartAction =
  | { type: 'add'; line: Omit<CartLine, 'id' | 'preDiscount' | 'lineTotal'> }
  | { type: 'remove'; id: string }
  | { type: 'restore'; lines: readonly CartLineInput[] }
  | { type: 'reset' };

export const EMPTY_CART: CartState = { lines: [] };

let counter = 0;
export function nextLineId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

export function priceLine(
  line: Omit<CartLine, 'id' | 'preDiscount' | 'lineTotal'>,
): Pick<CartLine, 'preDiscount' | 'lineTotal'> {
  const groupOptions = line.groupItems.map((item) => ({
    ...item,
    unitPrice: item.unitPrice * item.qty,
  }));
  const amounts = computeLine({
    basePrice: line.unitPrice,
    parts: [...line.parts, ...groupOptions],
    bundles: line.bundles,
    qty: line.qty,
    discountRate: line.discountRate,
    currency: line.currency,
  });
  return { preDiscount: amounts.preDiscount, lineTotal: amounts.lineTotal };
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add':
      return {
        lines: [...state.lines, { ...action.line, id: nextLineId(), ...priceLine(action.line) }],
      };
    case 'remove':
      return { lines: state.lines.filter((line) => line.id !== action.id) };
    case 'restore':
      return {
        lines: action.lines.map((line) => ({ ...line, id: nextLineId(), ...priceLine(line) })),
      };
    case 'reset':
      return EMPTY_CART;
    default:
      return state;
  }
}

/** 저장된 견적 라인 → 장바구니 라인 입력 (담기, AC-63). 스냅샷 가격 그대로 */
export function linesFromSavedQuote(quote: SavedQuoteView): CartLineInput[] {
  return quote.lines.map((line) => {
    const base: CartLineInput = {
      kind: line.kind,
      itemCode: line.itemCode ?? undefined,
      groupId: line.groupId ?? undefined,
      name: line.name,
      priceType: line.priceType ?? undefined,
      qty: line.qty,
      unitPrice: Number(line.unitPrice),
      currency: line.currency,
      parts: line.parts,
      bundles: line.bundles,
      groupItems: line.groupItems,
      discountRate: Number(line.discountRate),
    };
    return base;
  });
}

/**
 * 복원한 초안 라인 → 첫 렌더 장바구니 (RSC 초기 props). id 를 순번으로 정해 서버 렌더와 하이드레이션 결과가 같다
 * (담기로 새로 추가하는 라인의 id 는 nextLineId 형식이라 겹치지 않는다).
 */
export function initialCart(lines: readonly CartLineInput[] | undefined): CartState {
  return {
    lines: (lines ?? []).map((line, index) => ({
      ...line,
      id: `restored-${index}`,
      ...priceLine(line),
    })),
  };
}

/** 장바구니 라인 → 견적 저장·초안 입력 (id·표시용 금액 제외) */
export function toLineInput(line: CartLine): CartLineInput {
  return {
    kind: line.kind,
    itemCode: line.itemCode,
    groupId: line.groupId,
    name: line.name,
    priceType: line.priceType,
    qty: line.qty,
    unitPrice: line.unitPrice,
    currency: line.currency,
    parts: line.parts,
    bundles: line.bundles,
    groupItems: line.groupItems,
    discountRate: line.discountRate,
  };
}

/** 장바구니 → 입력 초안 `cart` 값 (비었으면 null = 서버 초안 삭제) */
export function cartDraftOf(lines: readonly CartLine[]): CartDraft | null {
  if (lines.length === 0) return null;
  return { lines: lines.map(toLineInput) };
}

/** 예전 sessionStorage 장바구니 키를 지운다 (이전하지 않음) */
export function clearLegacyCart(storage: Pick<Storage, 'removeItem'> | undefined): void {
  try {
    storage?.removeItem(LEGACY_CART_STORAGE_KEY);
  } catch {
    // 저장소를 못 쓰는 환경(프라이빗 모드 등) — 지울 것도 없다
  }
}

/** 라인 설명 (장바구니·저장 요약): "정상판매 · 파츠 2 · 결합형 1 · × 2" */
export function describeLine(line: CartLine): string {
  const parts = [line.priceType ?? (line.kind === 'group' ? '그룹' : '')];
  if (line.parts.length > 0) parts.push(`파츠 ${line.parts.length}`);
  if (line.bundles.length > 0) parts.push(`결합형 ${line.bundles.length}`);
  if (line.groupItems.length > 0) parts.push(`상세 ${line.groupItems.length}`);
  if (line.discountRate > 0) parts.push(`할인 ${line.discountRate}%`);
  parts.push(`× ${line.qty}`);
  return parts.filter(Boolean).join(' · ');
}
