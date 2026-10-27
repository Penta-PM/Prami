/**
 * 조달이 이관(DB-3) 대상 테이블 명세 — 0012_procurement_schema 의 열 이름·타입·순서 그대로.
 * 이관·검증은 Drizzle 스키마를 import 하지 않고 이 명세로 raw SQL 을 만든다(격리 규칙과 무관한 순수 상수).
 * 원본 값은 모두 Postgres 텍스트 표현(string | null)으로 다루고, 타입 변환은 대상 DB 가 `::타입` 캐스트로 한다
 * (CSV·원본 DB 어느 쪽이든 같은 규칙 — 해시·합계 비교도 같은 캐스트를 거친다).
 */
export type ColumnType =
  | 'bigint'
  | 'integer'
  | 'numeric'
  | 'text'
  | 'text[]'
  | 'boolean'
  | 'date'
  | 'timestamptz'
  | 'jsonb';

export type TableSpec = {
  name: ProcurementTableName;
  columns: readonly (readonly [string, ColumnType])[];
  /** 정렬 해시·키 순서 열 (기본 키) */
  key: string;
  /** bigserial id — 적재 후 setval 대상 */
  serial: boolean;
};

/** 적재 순서 = FK 순서 (items → item_changes → deliveries → delivery_changes → bid_notices → bid_keywords → job_runs → app_state) */
export const PROCUREMENT_TABLE_NAMES = [
  'items',
  'item_changes',
  'deliveries',
  'delivery_changes',
  'bid_notices',
  'bid_keywords',
  'job_runs',
  'app_state',
] as const;
export type ProcurementTableName = (typeof PROCUREMENT_TABLE_NAMES)[number];

export const PROCUREMENT_TABLES: Record<ProcurementTableName, TableSpec> = {
  items: {
    name: 'items',
    key: 'id',
    serial: true,
    columns: [
      ['id', 'bigint'],
      ['item_id', 'text'],
      ['product', 'text'],
      ['product_group', 'text'],
      ['detail_category', 'text'],
      ['manufacturer', 'text'],
      ['item_name', 'text'],
      ['registered_on', 'date'],
      ['collected_on', 'date'],
      ['status', 'text'],
      ['reviewed', 'boolean'],
      ['source', 'text'],
      ['created_at', 'timestamptz'],
      ['updated_at', 'timestamptz'],
    ],
  },
  item_changes: {
    name: 'item_changes',
    key: 'id',
    serial: true,
    columns: [
      ['id', 'bigint'],
      ['item_pk', 'bigint'],
      ['action', 'text'],
      ['before', 'jsonb'],
      ['after', 'jsonb'],
      ['changed_by', 'text'],
      ['changed_at', 'timestamptz'],
    ],
  },
  deliveries: {
    name: 'deliveries',
    key: 'id',
    serial: true,
    columns: [
      ['id', 'bigint'],
      ['dlvr_req_no', 'text'],
      ['item_id', 'text'],
      ['change_ord', 'text'],
      ['dlvr_req_date', 'date'],
      ['demand_org', 'text'],
      ['demand_org_type', 'text'],
      ['business_name', 'text'],
      ['contract_no', 'text'],
      ['contract_type', 'text'],
      ['vendor', 'text'],
      ['vendor_type', 'text'],
      ['vendor_address', 'text'],
      ['procurement_office', 'text'],
      ['class_code', 'text'],
      ['class_name', 'text'],
      ['item_name', 'text'],
      ['due_date', 'date'],
      ['unit_price', 'bigint'],
      ['unit', 'text'],
      ['quantity', 'numeric'],
      ['amount', 'bigint'],
      ['total_amount', 'bigint'],
      ['collected_on', 'date'],
      ['raw', 'jsonb'],
      ['created_at', 'timestamptz'],
      ['excluded', 'boolean'],
    ],
  },
  delivery_changes: {
    name: 'delivery_changes',
    key: 'id',
    serial: true,
    columns: [
      ['id', 'bigint'],
      ['delivery_id', 'bigint'],
      ['before', 'jsonb'],
      ['after', 'jsonb'],
      ['changed_by', 'text'],
      ['changed_at', 'timestamptz'],
    ],
  },
  bid_notices: {
    name: 'bid_notices',
    key: 'bid_no',
    serial: false,
    columns: [
      ['bid_no', 'text'],
      ['bid_ord', 'text'],
      ['products', 'text[]'],
      ['title', 'text'],
      ['business_type', 'text'],
      ['order_org', 'text'],
      ['demand_org', 'text'],
      ['posted_at', 'timestamptz'],
      ['deadline_at', 'timestamptz'],
      ['budget', 'bigint'],
      ['est_price', 'bigint'],
      ['notice_status', 'text'],
      ['detail_url', 'text'],
      ['collected_at', 'timestamptz'],
      ['raw', 'jsonb'],
      ['keywords', 'text[]'],
      ['fit_grade', 'text'],
      ['fit_score', 'integer'],
      ['fit_reasons', 'text[]'],
    ],
  },
  bid_keywords: {
    name: 'bid_keywords',
    key: 'id',
    serial: true,
    columns: [
      ['id', 'bigint'],
      ['product', 'text'],
      ['keyword', 'text'],
      ['created_by', 'text'],
      ['created_at', 'timestamptz'],
    ],
  },
  job_runs: {
    name: 'job_runs',
    key: 'id',
    serial: true,
    columns: [
      ['id', 'bigint'],
      ['job', 'text'],
      ['started_at', 'timestamptz'],
      ['finished_at', 'timestamptz'],
      ['status', 'text'],
      ['summary', 'jsonb'],
    ],
  },
  app_state: {
    name: 'app_state',
    key: 'key',
    serial: false,
    columns: [
      ['key', 'text'],
      ['value', 'jsonb'],
      ['updated_at', 'timestamptz'],
    ],
  },
};

/** 원본 값 한 칸 — Postgres 텍스트 표현 또는 NULL */
export type SourceValue = string | null;
/** 테이블별 원본 행 (열 순서 = PROCUREMENT_TABLES[t].columns) */
export type SourceData = Record<ProcurementTableName, SourceValue[][]>;

export const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;
