import { z } from 'zod';

import type { Db } from '@/db';
import { coreApplies } from '@/lib/pricing/quote';

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
    /** 코어 적용 행(Y + 기준 1 이상)만 — 기준코어수·단가(1코어). N·기준 0 행은 키 자체가 없다 (D.AMO 코어 단가 스펙 §4) */
    baseCoreCount: z.number().int().optional(),
    unitPricePerCore: z.string().optional(),
  })
  .strict();

export const ItemSchema = z
  .object({ itemCode: z.string(), itemName: z.string(), productFamily: z.string() })
  .strict();

export type PriceView = z.infer<typeof PriceSchema>;

export function priceView(price: ChatPrice): PriceView {
  const view: PriceView = {
    unitPrice: price.unitPrice,
    currency: price.currency,
    priceType: price.priceType,
    effectiveFrom: price.effectiveFrom,
  };
  // N 품목 출력은 키까지 그대로(코어 키 없음) — 코어 적용 행에만 덧붙인다
  if (!coreApplies(price)) return view;
  return { ...view, baseCoreCount: price.baseCoreCount, unitPricePerCore: price.unitPricePerCore };
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
