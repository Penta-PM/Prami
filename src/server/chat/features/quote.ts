import { z } from 'zod';

import { calculatorHref } from '../respond';
import { FamilySchema, ItemSchema, itemView, searchItems } from './shared';
import type { ChatFeature, ChatToolDef } from './types';

/** quote_start (§4.3.5): 견적 계산기 시작 링크(`/calculator…` 내부 경로만). 품목이 확정되면 품목까지 선택된 링크 */
const input = z
  .object({
    query: z.string().min(1).max(100).nullable().describe('품명 또는 품번, 모르면 null'),
    family: FamilySchema.describe('제품군, 모르면 null'),
  })
  .strict();

/** 내부 경로만 (§4.3.10 — `//` 로 시작하는 외부 URL 금지) */
export const CalculatorHref = z
  .string()
  .startsWith('/calculator')
  .refine((href) => !href.startsWith('//'), '내부 경로만');

const output = z
  .object({
    status: z.enum(['item', 'family', 'candidates', 'not_found', 'ask_product']),
    item: ItemSchema.nullable(),
    href: CalculatorHref.nullable(),
    candidates: z.array(ItemSchema).max(5),
  })
  .strict();

type Output = z.infer<typeof output>;

const EMPTY: Omit<Output, 'status'> = { item: null, href: null, candidates: [] };

export const quoteStartTool: ChatToolDef<typeof input, typeof output> = {
  name: 'quote_start',
  description: '견적 계산기를 여는 링크를 만든다. 품목이나 제품군을 알면 미리 선택된 링크를 준다.',
  input,
  output,
  run: async ({ query, family }, { db }) => {
    if (!query) {
      if (!family) return { data: { status: 'ask_product', ...EMPTY } };
      const href = calculatorHref(family);
      const label = `${family} 견적 계산기 열기`;
      return {
        data: { ...EMPTY, status: 'family', href },
        artifact: { action: { type: 'calculator', href, label } },
      };
    }
    const hits = await searchItems(db, query, family);
    if (hits.length === 0) return { data: { status: 'not_found', ...EMPTY } };
    if (hits.length > 1) {
      const shown = hits.slice(0, 5);
      return {
        data: { ...EMPTY, status: 'candidates', candidates: shown.map(itemView) },
        artifact: { candidates: shown },
      };
    }
    const item = itemView(hits[0]!);
    const href = calculatorHref(item.productFamily, item.itemCode);
    return {
      data: { ...EMPTY, status: 'item', item, href },
      artifact: { action: { type: 'calculator', href, label: '견적 계산기에서 이어서 선택' } },
    };
  },
};

export const quoteFeature: ChatFeature = {
  id: 'quote',
  title: '견적 시작',
  permission: 'calculator.use',
  sideEffect: 'none',
  promptHint: 'quote_start: 견적 계산기 시작 링크 (품목·제품군을 알면 미리 선택)',
  ruleIntent: 'quote',
  tools: [quoteStartTool],
};
