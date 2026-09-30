import { z } from 'zod';

import { latestChatPrice, previousChatPrice } from '../queries';
import { ItemSchema, itemView, PriceSchema, priceView, searchItems } from './shared';
import type { ChatFeature, ChatToolDef } from './types';

/** price_compare_previous (§4.3.5): 최신 운영중 가격 vs 같은 단가유형의 이전 적용 가격 (규칙 경로 연도 비교와 같은 쿼리) */
const input = z.object({ query: z.string().min(1).max(100).describe('품명 또는 품번') }).strict();

const output = z
  .object({
    status: z.enum(['compared', 'no_previous', 'no_current', 'candidates', 'not_found']),
    item: ItemSchema.nullable(),
    current: PriceSchema.nullable(),
    previous: PriceSchema.nullable(),
    changePct: z.number().nullable(),
    candidates: z.array(ItemSchema).max(5),
  })
  .strict();

type Output = z.infer<typeof output>;

const EMPTY: Omit<Output, 'status'> = {
  item: null,
  current: null,
  previous: null,
  changePct: null,
  candidates: [],
};

function changePct(before: string, after: string, sameCurrency: boolean): number | null {
  const from = Number(before);
  if (!sameCurrency || from <= 0) return null;
  return Math.round(((Number(after) - from) / from) * 1000) / 10;
}

export const priceCompareTool: ChatToolDef<typeof input, typeof output> = {
  name: 'price_compare_previous',
  description: '품목의 현재 판매단가와 이전 적용 판매단가를 비교해 변동률을 준다.',
  input,
  output,
  run: async ({ query }, { db }) => {
    const hits = await searchItems(db, query, null);
    if (hits.length === 0) return { data: { status: 'not_found', ...EMPTY } };
    if (hits.length > 1) {
      const shown = hits.slice(0, 5);
      return {
        data: { status: 'candidates', ...EMPTY, candidates: shown.map(itemView) },
        artifact: { candidates: shown },
      };
    }
    const item = itemView(hits[0]!);
    const current = await latestChatPrice(db, item.itemCode);
    if (!current) return { data: { status: 'no_current', ...EMPTY, item } };
    const previous = await previousChatPrice(db, current);
    const now = priceView(current);
    if (!previous) return { data: { status: 'no_previous', ...EMPTY, item, current: now } };
    const pct = changePct(
      previous.unitPrice,
      current.unitPrice,
      previous.currency === current.currency,
    );
    return {
      data: {
        ...EMPTY,
        status: 'compared',
        item,
        current: now,
        previous: priceView(previous),
        changePct: pct,
      },
    };
  },
};

export const compareFeature: ChatFeature = {
  id: 'compare',
  title: '가격 변동 비교',
  permission: 'pricing.read',
  sideEffect: 'none',
  promptHint: 'price_compare_previous: 품목의 현재 판매단가와 이전 적용가 비교',
  ruleIntent: 'compare',
  tools: [priceCompareTool],
};
