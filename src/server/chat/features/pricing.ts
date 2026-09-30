import { z } from 'zod';

import { latestChatPrice } from '../queries';
import { calculatorHref, LISTED_CANDIDATE_MAX, PRICED_CANDIDATE_MAX } from '../respond';
import { FamilySchema, ItemSchema, itemView, PriceSchema, priceView, searchItems } from './shared';
import type { ChatFeature, ChatToolDef } from './types';

/**
 * price_lookup (§4.3.5): 판정 규칙은 PRAMI-001 §4.5.9 r6 ①~④ 그대로 — 1건 확정(found)·2~3건 가격 병기(candidates)·
 * 4건 이상 가격 없이 ≤5건(too_many)·0건(not_found).
 */
const input = z
  .object({
    query: z.string().min(1).max(100).describe('품명 또는 품번 (예: Wapples-500, P2002030005)'),
    family: FamilySchema.describe('제품군을 알면 지정, 모르면 null'),
  })
  .strict();

const PricedItemSchema = ItemSchema.extend({ price: PriceSchema.nullable() }).strict();

const output = z
  .object({
    status: z.enum(['found', 'candidates', 'too_many', 'not_found']),
    items: z.array(PricedItemSchema).max(LISTED_CANDIDATE_MAX),
  })
  .strict();

export const priceLookupTool: ChatToolDef<typeof input, typeof output> = {
  name: 'price_lookup',
  description: '판매단가를 품명 또는 품번으로 조회한다. 여러 품목이 걸리면 후보 목록을 준다.',
  statusLabel: '가격 조회 중',
  input,
  output,
  run: async ({ query, family }, { db }) => {
    const hits = await searchItems(db, query, family);
    if (hits.length === 0) return { data: { status: 'not_found', items: [] } };
    if (hits.length > PRICED_CANDIDATE_MAX) {
      const shown = hits.slice(0, LISTED_CANDIDATE_MAX);
      const items = shown.map((hit) => ({ ...itemView(hit), price: null }));
      return { data: { status: 'too_many', items }, artifact: { candidates: shown } };
    }
    const priced = await Promise.all(
      hits.map(async (hit) => {
        const price = await latestChatPrice(db, hit.itemCode);
        return { ...itemView(hit), price: price ? priceView(price) : null };
      }),
    );
    if (hits.length > 1) {
      return { data: { status: 'candidates', items: priced }, artifact: { candidates: hits } };
    }
    const only = priced[0]!;
    const href = calculatorHref(only.productFamily, only.itemCode);
    return {
      data: { status: 'found', items: priced },
      artifact: { action: { type: 'calculator', href, label: '이 품목으로 견적 시작' } },
    };
  },
};

export const pricingFeature: ChatFeature = {
  id: 'pricing',
  title: '가격 조회',
  permission: 'pricing.read',
  sideEffect: 'none',
  promptHint: 'price_lookup: 품명·품번으로 현재 판매단가 조회 (후보가 여럿이면 목록)',
  ruleIntent: 'price',
  tools: [priceLookupTool],
};
