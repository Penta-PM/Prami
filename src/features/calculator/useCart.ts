'use client';

import { useEffect, useReducer } from 'react';

import { cartReducer, clearLegacyCart, initialCart, type CartAction, type CartState } from './cart';
import type { CartLineInput } from './types';

/**
 * 장바구니: useReducer (§4.5.7). 첫 렌더 값은 RSC 가 읽은 입력 초안 `cart`(최신가 갱신 후)라 SSR 마크업과 같다.
 * 서버 저장은 useDraftSync 가 맡고, 예전 sessionStorage 키(`prami.quote.cart.v1`)는 마운트 때 지운다(page-state-memory §2.4-6).
 */
export function useCart(
  initialLines?: readonly CartLineInput[],
): [CartState, (action: CartAction) => void] {
  const [state, dispatch] = useReducer(cartReducer, initialLines, initialCart);

  useEffect(() => {
    clearLegacyCart(typeof window === 'undefined' ? undefined : window.sessionStorage);
  }, []);

  return [state, dispatch];
}
