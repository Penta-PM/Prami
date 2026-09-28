import { describe, expect, it } from 'vitest';

import {
  cartReducer,
  CART_STORAGE_KEY,
  describeLine,
  EMPTY_CART,
  linesFromSavedQuote,
  loadCart,
  persistCart,
} from '@/features/calculator/cart';
import type { CartLine, SavedQuoteView } from '@/features/calculator/types';

/** 장바구니 리듀서·sessionStorage·담기 복원 (§4.5.7, AC-63·65) */
const base = {
  kind: 'item' as const,
  itemCode: 'P1',
  name: 'Wapples-500',
  priceType: '정상판매',
  qty: 2,
  unitPrice: 20_000_000,
  currency: 'KRW',
  parts: [{ itemCode: 'N1', itemName: 'N_51080', unitPrice: 500_000 }],
  bundles: [],
  groupItems: [],
  discountRate: 12.5,
};

describe('cartReducer', () => {
  it('add 는 금액을 계산해 라인을 붙이고(AC-60 케이스), remove·reset·restore', () => {
    const added = cartReducer(EMPTY_CART, { type: 'add', line: base });
    expect(added.lines).toHaveLength(1);
    expect(added.lines[0]).toMatchObject({ preDiscount: 41_000_000, lineTotal: 35_875_000 });
    expect(added.lines[0]!.id).toBeTruthy();
    const two = cartReducer(added, {
      type: 'add',
      line: { ...base, currency: 'USD', unitPrice: 10, parts: [], qty: 1, discountRate: 0 },
    });
    expect(two.lines).toHaveLength(2);
    expect(cartReducer(two, { type: 'remove', id: two.lines[0]!.id }).lines).toHaveLength(1);
    expect(cartReducer(two, { type: 'reset' })).toEqual(EMPTY_CART);
    const restored = cartReducer(EMPTY_CART, { type: 'restore', lines: two.lines });
    expect(restored.lines.map((line) => line.name)).toEqual(two.lines.map((line) => line.name));
    expect(restored.lines[0]!.id).not.toBe(two.lines[0]!.id);
  });

  it('그룹 라인은 상세 제품 단가 × 수량을 옵션처럼 합산한다', () => {
    const group = cartReducer(EMPTY_CART, {
      type: 'add',
      line: {
        kind: 'group',
        groupId: '22222222-0000-4000-8000-000000000001',
        name: '그룹 A · HW',
        qty: 1,
        unitPrice: 1_000_000,
        currency: 'KRW',
        parts: [],
        bundles: [],
        groupItems: [
          { itemCode: 'A', itemName: 'a', unitPrice: 100_500, qty: 2 },
          { itemCode: 'B', itemName: 'b', unitPrice: 50_000, qty: 1 },
        ],
        discountRate: 0,
      },
    });
    expect(group.lines[0]).toMatchObject({ preDiscount: 1_251_000, lineTotal: 1_251_000 });
  });
});

describe('sessionStorage', () => {
  it('저장·복원, 깨진 값·없는 저장소는 빈 장바구니', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const state = cartReducer(EMPTY_CART, { type: 'add', line: base });
    persistCart(storage, state);
    expect(store.has(CART_STORAGE_KEY)).toBe(true);
    expect(loadCart(storage)).toEqual(state);
    store.set(CART_STORAGE_KEY, '{not json');
    expect(loadCart(storage)).toEqual(EMPTY_CART);
    expect(loadCart(undefined)).toEqual(EMPTY_CART);
    expect(() =>
      persistCart(
        {
          setItem: () => {
            throw new Error('quota');
          },
        },
        state,
      ),
    ).not.toThrow();
  });
});

describe('linesFromSavedQuote / describeLine', () => {
  it('저장된 라인 스냅샷을 장바구니 라인으로 복원한다 (가격 스냅샷 그대로)', () => {
    const quote: SavedQuoteView = {
      id: 'q',
      quoteNo: 'Q-2026-0001',
      productFamily: 'WAPPLES',
      title: 't',
      summary: 's',
      totalAmount: '35875000',
      currency: 'KRW',
      createdAt: '2026-09-29T00:00:00.000Z',
      ownerUserId: 'u',
      lines: [
        {
          kind: 'item',
          itemCode: 'P1',
          groupId: null,
          priceType: '정상판매',
          name: 'Wapples-500',
          qty: 2,
          unitPrice: '20000000.00',
          currency: 'KRW',
          parts: base.parts,
          bundles: [],
          groupItems: [],
          discountRate: '12.5',
          preDiscount: '41000000.00',
          lineTotal: '35875000.00',
        },
      ],
    };
    const [line] = linesFromSavedQuote(quote) as [CartLine];
    expect(line).toMatchObject({
      kind: 'item',
      itemCode: 'P1',
      unitPrice: 20_000_000,
      discountRate: 12.5,
      preDiscount: 41_000_000,
      lineTotal: 35_875_000,
    });
    expect(describeLine(line)).toBe('정상판매 · 파츠 1 · 할인 12.5% · × 2');
  });
});
