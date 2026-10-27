import { bigint, boolean, date, jsonb, numeric, text, timestamp } from 'drizzle-orm/pg-core';

import { procurementSchema } from './schema';

/**
 * procurement 뷰 3개 — 정의(SQL)는 drizzle/0012_procurement_schema.sql 끝의 손 작성 구간에 컬럼을 명시해 두고,
 * 여기서는 `.existing()` 으로 타입만 선언한다(drizzle-kit 이 만들거나 지우지 않는다).
 */

/** v_deliveries / v_product_deliveries 가 내보내는 deliveries 열 (원본 `d.*` 를 명시한 것, 열 순서 동일) */
function deliveryColumns() {
  return {
    id: bigint('id', { mode: 'number' }).notNull(),
    dlvrReqNo: text('dlvr_req_no').notNull(),
    itemId: text('item_id').notNull(),
    changeOrd: text('change_ord').notNull(),
    dlvrReqDate: date('dlvr_req_date'),
    demandOrg: text('demand_org'),
    demandOrgType: text('demand_org_type'),
    businessName: text('business_name'),
    contractNo: text('contract_no'),
    contractType: text('contract_type'),
    vendor: text('vendor'),
    vendorType: text('vendor_type'),
    vendorAddress: text('vendor_address'),
    procurementOffice: text('procurement_office'),
    classCode: text('class_code'),
    className: text('class_name'),
    itemName: text('item_name'),
    dueDate: date('due_date'),
    unitPrice: bigint('unit_price', { mode: 'number' }),
    unit: text('unit'),
    quantity: numeric('quantity'),
    amount: bigint('amount', { mode: 'number' }),
    totalAmount: bigint('total_amount', { mode: 'number' }),
    collectedOn: date('collected_on'),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    excluded: boolean('excluded').notNull(),
  };
}

/** 납품요구 한 건((요구번호, 물품)) 당 한 줄 — 변경차수가 여러 개면 첫 차수(D-9), 삭제 표시된 건 제외 */
export const procurementVDeliveries = procurementSchema
  .view('v_deliveries', deliveryColumns())
  .existing();

/** 제품별 납품요구 = v_deliveries + 등록 물품(items: active, 제품 '기타' 제외) 연결. 조달 통계의 기준 데이터 */
export const procurementVProductDeliveries = procurementSchema
  .view('v_product_deliveries', {
    product: text('product').notNull(),
    productGroup: text('product_group'),
    detailCategory: text('detail_category'),
    ...deliveryColumns(),
  })
  .existing();

/** 물품별 최근 계약단가 (0 초과 단가 중 가장 최근 납품요구일자 기준, 납품 이력이 있는 물품만) */
export const procurementVItemPrices = procurementSchema
  .view('v_item_prices', {
    itemId: text('item_id').notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    priceDate: date('price_date'),
  })
  .existing();

export type ProcurementVDelivery = typeof procurementVDeliveries.$inferSelect;
export type ProcurementVProductDelivery = typeof procurementVProductDeliveries.$inferSelect;
export type ProcurementVItemPrice = typeof procurementVItemPrices.$inferSelect;
