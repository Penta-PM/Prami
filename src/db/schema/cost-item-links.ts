import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './columns';
import { users } from './users';

/**
 * 원가 매핑 (스펙 cost-ratio-price-change §2.1). 가격 품목코드(P…) → 원가 자재번호(W…). 관리자가 확정한 행만 저장한다
 * (모델명 휴리스틱 제안은 저장하지 않는다). **원가 영역** — server/cost/* 만 조회한다(ESLint 격리, AC-42).
 * - item_code 는 items 를 참조하지 않는다: 가격 임포트로 품번이 사라져도 링크는 남고 화면에 '품목 없음'으로 보인다.
 * - material_code 는 material_costs 의 자재번호(계열 키 일부)라 단일 키 FK 가 없다.
 */
export const costItemLinks = pgTable('cost_item_links', {
  itemCode: text('item_code').primaryKey(),
  materialCode: text('material_code').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

export type CostItemLink = typeof costItemLinks.$inferSelect;
