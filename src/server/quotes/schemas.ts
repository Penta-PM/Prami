import { z } from 'zod';

/** 장바구니 라인의 옵션 스냅샷 (§4.3.8 quote_lines.options) */
const pricedOption = z.object({
  itemCode: z.string().trim().min(1).max(50),
  itemName: z.string().trim().min(1).max(300),
  unitPrice: z.coerce.number().min(0).max(1e15),
});

const groupItem = pricedOption.extend({ qty: z.coerce.number().int().min(1).max(9999) });

const money = z.coerce.number().min(0).max(1e15);

export const quoteLineSchema = z.object({
  kind: z.enum(['item', 'group']),
  /** item 라인 = 품번, group 라인 = 하드웨어 품번(선택) */
  itemCode: z.string().trim().max(50).optional(),
  groupId: z.uuid().optional(),
  name: z.string().trim().min(1).max(300),
  priceType: z.string().trim().max(100).optional(),
  qty: z.coerce.number().int().min(1).max(9999),
  /** 본품(또는 하드웨어) 단가 스냅샷 */
  unitPrice: money,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, '화폐는 3자리 코드입니다'),
  parts: z.array(pricedOption).max(100).default([]),
  bundles: z.array(pricedOption).max(100).default([]),
  groupItems: z.array(groupItem).max(200).default([]),
  discountRate: z.coerce.number().min(0).max(100).default(0),
});

export const saveQuoteSchema = z.object({
  productFamily: z.string().trim().min(1).max(50),
  title: z
    .string()
    .trim()
    .max(120)
    .regex(/^[^<>]*$/, '제목에 < > 는 쓸 수 없습니다')
    .optional(),
  lines: z.array(quoteLineSchema).min(1, '장바구니가 비어 있습니다').max(200),
});

export const deleteQuoteSchema = z.object({ id: z.uuid() });

export type QuoteLineInputDto = z.input<typeof quoteLineSchema>;
export type SaveQuoteInput = z.input<typeof saveQuoteSchema>;
export type DeleteQuoteInput = z.input<typeof deleteQuoteSchema>;
