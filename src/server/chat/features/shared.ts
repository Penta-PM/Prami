import { z } from 'zod';

import type { Db } from '@/db';

import { classifyIntent, PRODUCT_FAMILIES } from '../intent';
import { findChatItemsByTerms, type ChatItemHit, type ChatPrice } from '../queries';

/** 도구 공통 스키마·검색 (규칙 경로와 같은 토큰 매칭·별칭 — intent/queries 재사용, 무수정) */
export const FamilySchema = z.enum(PRODUCT_FAMILIES).nullable();

export const PriceSchema = z
  .object({
    unitPrice: z.string(),
    currency: z.string(),
    priceType: z.string().nullable(),
    effectiveFrom: z.string(),
  })
  .strict();

export const ItemSchema = z
  .object({ itemCode: z.string(), itemName: z.string(), productFamily: z.string() })
  .strict();

export type PriceView = z.infer<typeof PriceSchema>;

export function priceView(price: ChatPrice): PriceView {
  return {
    unitPrice: price.unitPrice,
    currency: price.currency,
    priceType: price.priceType,
    effectiveFrom: price.effectiveFrom,
  };
}

export function itemView(hit: ChatItemHit) {
  return {
    itemCode: hit.itemCode,
    itemName: hit.itemName.trim(),
    productFamily: hit.productFamily,
  };
}

/** 모델이 준 검색어에서 서술어·조사를 걷어내고 별칭을 넓힌다 (classifyIntent 재사용) */
export async function searchItems(db: Db, query: string, family: string | null) {
  const intent = classifyIntent(query);
  const terms = intent.terms.length > 0 ? intent.terms : [query.trim()];
  const { hits } = await findChatItemsByTerms(db, terms, family ?? intent.family);
  return hits;
}
