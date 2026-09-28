import { computeLine } from '@/lib/pricing/quote';

import type { CartLine, SavedQuoteView } from './types';

/**
 * 장바구니 상태 (§4.5.7): useReducer + sessionStorage. 라인 금액은 담을 때 순수 함수로 계산해 두고,
 * 저장 시 서버가 같은 함수로 다시 계산한다. 순수 모듈이라 단위 테스트가 쉽다.
 */
export const CART_STORAGE_KEY = 'prami.quote.cart.v1';

export type CartState = { lines: CartLine[] };

export type CartAction =
  | { type: 'add'; line: Omit<CartLine, 'id' | 'preDiscount' | 'lineTotal'> }
  | { type: 'remove'; id: string }
  | { type: 'restore'; lines: CartLine[] }
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
      return { lines: action.lines.map((line) => ({ ...line, id: nextLineId() })) };
    case 'reset':
      return EMPTY_CART;
    default:
      return state;
  }
}

/** 저장된 견적 라인 → 장바구니 라인 (담기, AC-63). 스냅샷 가격 그대로 */
export function linesFromSavedQuote(quote: SavedQuoteView): CartLine[] {
  return quote.lines.map((line) => {
    const base = {
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
    return { ...base, id: nextLineId(), ...priceLine(base) };
  });
}

export function loadCart(storage: Pick<Storage, 'getItem'> | undefined): CartState {
  try {
    const raw = storage?.getItem(CART_STORAGE_KEY);
    if (!raw) return EMPTY_CART;
    const parsed = JSON.parse(raw) as { lines?: unknown };
    if (!Array.isArray(parsed.lines)) return EMPTY_CART;
    return { lines: parsed.lines as CartLine[] };
  } catch {
    return EMPTY_CART;
  }
}

export function persistCart(storage: Pick<Storage, 'setItem'> | undefined, state: CartState) {
  try {
    storage?.setItem(CART_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage 를 못 쓰는 환경(프라이빗 모드 등)에서는 메모리 상태만 유지한다
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
