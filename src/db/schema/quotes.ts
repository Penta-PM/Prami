import {
  bigserial,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { deletedAt, timestamps } from './columns';
import { quoteLineKindEnum, quoteStatusEnum } from './enums';
import { users } from './users';

/** 견적 (§4.3.8, 2차). 라인에 가격 스냅샷을 저장해 정책 변경 후에도 금액 불변 */
export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Q-YYYY-NNNN (연도별 시퀀스, Q-13) */
    quoteNo: text('quote_no').notNull().unique(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    productFamily: text('product_family'),
    title: text('title').notNull(),
    summary: text('summary'),
    totalAmount: numeric('total_amount', { precision: 18, scale: 0 }),
    currency: char('currency', { length: 3 }),
    status: quoteStatusEnum('status').notNull().default('draft'),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [index('quotes_owner_idx').on(t.ownerUserId, t.createdAt.desc())],
);

/** 견적 라인 (§4.3.8). item_code/group_id 는 스냅샷이므로 FK 를 두지 않는다 */
export const quoteLines = pgTable(
  'quote_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    kind: quoteLineKindEnum('kind').notNull(),
    itemCode: text('item_code'),
    groupId: uuid('group_id'),
    priceType: text('price_type'),
    qty: integer('qty').notNull().default(1),
    unitPrice: numeric('unit_price', { precision: 18, scale: 2 }).notNull(),
    /** 파츠·결합형 품번/가격 스냅샷 */
    options: jsonb('options').$type<Record<string, unknown>>(),
    discountRate: numeric('discount_rate', { precision: 5, scale: 1 }).notNull().default('0'),
    preDiscount: numeric('pre_discount', { precision: 18, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 18, scale: 2 }).notNull(),
  },
  (t) => [unique('quote_lines_quote_line_no_uq').on(t.quoteId, t.lineNo)],
);

/** 견적 공유 링크 (§4.3.8, 3차) */
export const quoteShares = pgTable('quote_shares', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id')
    .notNull()
    .references(() => quotes.id, { onDelete: 'cascade' }),
  /** 32바이트 랜덤 토큰 */
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Quote = typeof quotes.$inferSelect;
export type QuoteLine = typeof quoteLines.$inferSelect;
export type QuoteShare = typeof quoteShares.$inferSelect;
