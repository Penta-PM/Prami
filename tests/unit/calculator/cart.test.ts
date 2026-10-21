import { describe, expect, it } from 'vitest';

import {
  cartDraftOf,
  cartReducer,
  clearLegacyCart,
  describeLine,
  EMPTY_CART,
  initialCart,
  LEGACY_CART_STORAGE_KEY,
  linesFromSavedQuote,
  toLineInput,
} from '@/features/calculator/cart';
import { parseDraft } from '@/lib/page-state/drafts';
import type { CartLine, SavedQuoteView } from '@/features/calculator/types';

/** 장바구니 리듀서·입력 초안 변환·예전 sessionStorage 키 삭제·담기 복원 (§4.5.7, AC-63·65, page-state-memory §2.4-6) */
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

describe('입력 초안 cart (page-state-memory §2.4-6 — sessionStorage 저장 제거)', () => {
  it('예전 sessionStorage 키는 이전하지 않고 지운다 · 저장소 오류에도 던지지 않는다', () => {
    const store = new Map<string, string>([
      [LEGACY_CART_STORAGE_KEY, '{"lines":[{"name":"다른 사용자"}]}'],
    ]);
    clearLegacyCart({ removeItem: (key: string) => void store.delete(key) });
    expect(store.has(LEGACY_CART_STORAGE_KEY)).toBe(false);
    expect(LEGACY_CART_STORAGE_KEY).toBe('prami.quote.cart.v1');
    expect(() =>
      clearLegacyCart({
        removeItem: () => {
          throw new Error('denied');
        },
      }),
    ).not.toThrow();
    expect(() => clearLegacyCart(undefined)).not.toThrow();
  });

  it('장바구니 → 초안 값(id·표시 금액 제외, 스키마 통과) · 빈 장바구니는 null(삭제)', () => {
    const state = cartReducer(EMPTY_CART, { type: 'add', line: base });
    const draft = cartDraftOf(state.lines)!;
    expect(draft.lines[0]).not.toHaveProperty('id');
    expect(draft.lines[0]).not.toHaveProperty('lineTotal');
    expect(parseDraft('cart', 1, draft)).toEqual(draft);
    expect(cartDraftOf([])).toBeNull();
    expect(toLineInput(state.lines[0]!)).toEqual(base);
  });

  it('복원 첫 렌더 장바구니는 순번 id·다시 계산한 금액 (서버 렌더 = 하이드레이션)', () => {
    const first = initialCart([base, base]);
    const second = initialCart([base, base]);
    expect(first).toEqual(second);
    expect(first.lines.map((line) => line.id)).toEqual(['restored-0', 'restored-1']);
    expect(first.lines[0]).toMatchObject({
      preDiscount: expect.any(Number),
      lineTotal: expect.any(Number),
    });
    expect(initialCart(undefined)).toEqual(EMPTY_CART);
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
    const [line] = cartReducer(EMPTY_CART, {
      type: 'restore',
      lines: linesFromSavedQuote(quote),
    }).lines as [CartLine];
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
