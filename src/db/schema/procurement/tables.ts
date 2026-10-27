import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { procurementSchema } from './schema';

/**
 * procurement 스키마 테이블 8개 — 조달이 원본 DDL 의 컬럼·타입·제약·인덱스를 그대로 옮긴다 (DB-1).
 * 제약 이름은 원본이 이름 없이 만든 제약에 PostgreSQL 이 붙이는 기본 이름(`<표>_<열>_check`·`_key`·`_fkey`)과 같게 둔다.
 * 열 순서도 원본과 같다(나중에 ALTER 로 더해진 열은 끝 — deliveries.excluded, bid_notices.keywords·fit_*).
 * `items.updated_at`·`items.product_group` 은 DB 트리거 `procurement.items_before_write` 가 채운다(0012 마이그레이션 SQL).
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** 물품(물품식별번호 + 제품 한 줄). status: pending(제품 미정 검토 대기)·active(등록)·excluded(휴지통) */
export const procurementItems = procurementSchema.table(
  'items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 물품식별번호 (문자로 보관) */
    itemId: text('item_id').notNull(),
    /** 제품: WAPPLES / D.AMO / iSIGN / 기타(미분류) */
    product: text('product').notNull(),
    /** iSIGN 세부 그룹 — 트리거가 detail_category 로 계산, iSIGN 외에는 null */
    productGroup: text('product_group'),
    detailCategory: text('detail_category'),
    manufacturer: text('manufacturer'),
    itemName: text('item_name'),
    registeredOn: date('registered_on'),
    /** 처음 수집된 기준일 */
    collectedOn: date('collected_on'),
    status: text('status').notNull().default('active'),
    /** 사람이 확인했는지 (false 면 일일 신규 품목) */
    reviewed: boolean('reviewed').notNull().default(false),
    source: text('source').notNull().default('auto'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('items_status_check', sql`${t.status} in ('pending', 'active', 'excluded')`),
    check('items_source_check', sql`${t.source} in ('auto', 'manual')`),
    unique('items_item_id_product_key').on(t.itemId, t.product),
    index('items_item_id_idx').on(t.itemId),
    index('items_status_idx').on(t.status, t.product),
  ],
);

/** 물품 변경 이력 (화면에서 추가·수정·제외한 기록). 물품이 지워지면 item_pk 만 비운다 */
export const procurementItemChanges = procurementSchema.table(
  'item_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    itemPk: bigint('item_pk', { mode: 'number' }),
    /** add / edit / exclude / include / review */
    action: text('action').notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    changedBy: text('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'item_changes_item_pk_fkey',
      columns: [t.itemPk],
      foreignColumns: [procurementItems.id],
    }).onDelete('set null'),
  ],
);

/** 납품요구 (변경차수마다 한 줄). excluded = 화면에서 삭제(휴지통) 표시 */
export const procurementDeliveries = procurementSchema.table(
  'deliveries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 납품요구번호 */
    dlvrReqNo: text('dlvr_req_no').notNull(),
    /** 물품식별번호 (items.item_id 와 연결 — FK 아님) */
    itemId: text('item_id').notNull(),
    /** 납품요구변경차수 ('00' 이 첫 요청) */
    changeOrd: text('change_ord').notNull().default('00'),
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
    /** 계약단가 (원) */
    unitPrice: bigint('unit_price', { mode: 'number' }),
    unit: text('unit'),
    quantity: numeric('quantity'),
    /** 납품금액 (원) — 매출·점유율 집계 기준 */
    amount: bigint('amount', { mode: 'number' }),
    /** 납품요구총금액 (원) */
    totalAmount: bigint('total_amount', { mode: 'number' }),
    collectedOn: date('collected_on'),
    /** 수집 원본 */
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    excluded: boolean('excluded').notNull().default(false),
  },
  (t) => [
    unique('deliveries_dlvr_req_no_item_id_change_ord_key').on(t.dlvrReqNo, t.itemId, t.changeOrd),
    index('deliveries_item_id_idx').on(t.itemId),
    index('deliveries_date_idx').on(t.dlvrReqDate),
  ],
);

/** 납품요구 변경 이력 (바뀐 칸만 before/after) */
export const procurementDeliveryChanges = procurementSchema.table(
  'delivery_changes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deliveryId: bigint('delivery_id', { mode: 'number' }),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    changedBy: text('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'delivery_changes_delivery_id_fkey',
      columns: [t.deliveryId],
      foreignColumns: [procurementDeliveries.id],
    }).onDelete('set null'),
  ],
);

/** 입찰공고 (공고번호 = 차수 제외). 적합도(fit_*)는 수집기가 규칙 기반으로 계산 */
export const procurementBidNotices = procurementSchema.table(
  'bid_notices',
  {
    bidNo: text('bid_no').primaryKey(),
    bidOrd: text('bid_ord').notNull().default('000'),
    /** 관련 제품 (비어 있으면 화면에서 숨김) */
    products: text('products')
      .array()
      .notNull()
      .default(sql`'{}'`),
    title: text('title').notNull(),
    businessType: text('business_type'),
    orderOrg: text('order_org'),
    demandOrg: text('demand_org'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    /** 배정예산 (원) */
    budget: bigint('budget', { mode: 'number' }),
    /** 추정가격 (원) */
    estPrice: bigint('est_price', { mode: 'number' }),
    noticeStatus: text('notice_status'),
    detailUrl: text('detail_url'),
    collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    /** 걸린 분류 키워드 */
    keywords: text('keywords')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** 적합도 등급: 상 / 중 / 하 */
    fitGrade: text('fit_grade'),
    /** 적합도 점수 0~100 */
    fitScore: integer('fit_score'),
    /** 적합도 근거 (＋/－ 짧은 문장 목록) */
    fitReasons: text('fit_reasons')
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [
    index('bid_notices_posted_idx').on(t.postedAt.desc().nullsFirst()),
    check('bid_notices_fit_grade_check', sql`${t.fitGrade} in ('상', '중', '하')`),
  ],
);

/** 입찰공고 분류 키워드. product '제외' = 이 단어가 있으면 버림 */
export const procurementBidKeywords = procurementSchema.table(
  'bid_keywords',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    product: text('product').notNull(),
    keyword: text('keyword').notNull(),
    createdBy: text('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    check('bid_keywords_product_check', sql`${t.product} in ('WAPPLES', 'D.AMO', 'iSIGN', '제외')`),
    check('bid_keywords_keyword_check', sql`length(trim(${t.keyword})) > 0`),
    unique('bid_keywords_product_keyword_key').on(t.product, t.keyword),
  ],
);

/** 수집 작업 실행 기록 (daily / bids / refresh) */
export const procurementJobRuns = procurementSchema.table(
  'job_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    job: text('job').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull().default('running'),
    summary: jsonb('summary').$type<Record<string, unknown>>(),
  },
  (t) => [check('job_runs_status_check', sql`${t.status} in ('running', 'ok', 'failed')`)],
);

/** 수집 상태 값 (예: 마지막 보고 기준일·마지막 입찰공고 확인 시각) */
export const procurementAppState = procurementSchema.table('app_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProcurementItem = typeof procurementItems.$inferSelect;
export type NewProcurementItem = typeof procurementItems.$inferInsert;
export type ProcurementItemChange = typeof procurementItemChanges.$inferSelect;
export type ProcurementDelivery = typeof procurementDeliveries.$inferSelect;
export type NewProcurementDelivery = typeof procurementDeliveries.$inferInsert;
export type ProcurementDeliveryChange = typeof procurementDeliveryChanges.$inferSelect;
export type ProcurementBidNotice = typeof procurementBidNotices.$inferSelect;
export type ProcurementBidKeyword = typeof procurementBidKeywords.$inferSelect;
export type ProcurementJobRun = typeof procurementJobRuns.$inferSelect;
export type ProcurementAppState = typeof procurementAppState.$inferSelect;
