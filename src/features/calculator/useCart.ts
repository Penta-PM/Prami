'use client';

import { useEffect, useReducer, useRef } from 'react';

import {
  cartReducer,
  EMPTY_CART,
  loadCart,
  persistCart,
  type CartAction,
  type CartState,
} from './cart';

/** 장바구니: useReducer + sessionStorage (§4.5.7). 첫 렌더 후 복원해 SSR 마크업과 어긋나지 않게 한다 */
export function useCart(): [CartState, (action: CartAction) => void] {
  const [state, dispatch] = useReducer(cartReducer, EMPTY_CART);
  const hydrated = useRef(false);

  useEffect(() => {
    const stored = loadCart(typeof window === 'undefined' ? undefined : window.sessionStorage);
    if (stored.lines.length > 0) dispatch({ type: 'restore', lines: stored.lines });
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    persistCart(typeof window === 'undefined' ? undefined : window.sessionStorage, state);
  }, [state]);

  return [state, dispatch];
}
