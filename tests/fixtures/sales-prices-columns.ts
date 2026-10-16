/**
 * 스펙 §4.3.1 원본 20컬럼 스냅샷 (엑셀 헤더 순서 = ordinal 순서).
 * information_schema.columns 와 대조한다 (AC-01). 값을 바꾸려면 스펙 표를 먼저 갱신한다.
 */
export type DbColumnShape = {
  column: string;
  dataType: string;
  nullable: boolean;
  charLength?: number;
  precision?: number;
  scale?: number;
};

export type ColumnSnapshot = DbColumnShape & { excelHeader: string };

/** 스냅샷에서 DB 비교용 필드만 뽑는다 (엑셀 헤더는 문서용) */
export function dbShape(snapshot: ColumnSnapshot): DbColumnShape {
  return {
    column: snapshot.column,
    dataType: snapshot.dataType,
    nullable: snapshot.nullable,
    ...(snapshot.charLength !== undefined && { charLength: snapshot.charLength }),
    ...(snapshot.precision !== undefined && {
      precision: snapshot.precision,
      scale: snapshot.scale ?? 0,
    }),
  };
}

export const SALES_PRICE_SOURCE_COLUMNS: readonly ColumnSnapshot[] = [
  { excelHeader: 'id', column: 'source_id', dataType: 'integer', nullable: false },
  { excelHeader: '제품군', column: 'product_family', dataType: 'text', nullable: false },
  { excelHeader: '품번', column: 'item_code', dataType: 'text', nullable: false },
  { excelHeader: '품명', column: 'item_name', dataType: 'text', nullable: false },
  { excelHeader: '규격', column: 'spec', dataType: 'text', nullable: true },
  { excelHeader: '단위', column: 'unit', dataType: 'text', nullable: false },
  { excelHeader: '단가유형', column: 'price_type', dataType: 'text', nullable: true },
  { excelHeader: '단가구분', column: 'price_category', dataType: 'text', nullable: false },
  {
    excelHeader: '화폐',
    column: 'currency',
    dataType: 'character',
    nullable: false,
    charLength: 3,
  },
  { excelHeader: '코어단가유무', column: 'has_core_price', dataType: 'boolean', nullable: false },
  {
    excelHeader: '단가',
    column: 'unit_price',
    dataType: 'numeric',
    nullable: false,
    precision: 18,
    scale: 2,
  },
  { excelHeader: '비고', column: 'remark', dataType: 'text', nullable: true },
  { excelHeader: '적용시작일', column: 'effective_from', dataType: 'date', nullable: false },
  {
    excelHeader: '전체고객적용여부',
    column: 'applies_to_all_customers',
    dataType: 'boolean',
    nullable: false,
  },
  { excelHeader: '최종여부', column: 'is_final_source', dataType: 'boolean', nullable: false },
  { excelHeader: '기준코어수', column: 'base_core_count', dataType: 'integer', nullable: false },
  {
    excelHeader: '단가(1코어)',
    column: 'unit_price_per_core',
    dataType: 'numeric',
    nullable: false,
    precision: 18,
    scale: 2,
  },
  { excelHeader: '거래처코드', column: 'customer_code', dataType: 'text', nullable: false },
  { excelHeader: '고객 번호', column: 'customer_no', dataType: 'text', nullable: true },
  { excelHeader: '고객명', column: 'customer_name', dataType: 'text', nullable: true },
];

/** §4.3 전 테이블 (뷰 제외) */
export const EXPECTED_TABLES = [
  'audit_logs',
  'cost_item_links',
  'import_batches',
  'items',
  'material_costs',
  'notices',
  'notifications',
  'oauth_flow_states',
  'part_mappings',
  'policy_apply_runs',
  'quote_lines',
  'quote_shares',
  'quotes',
  'sales_prices',
  'solution_group_items',
  'solution_groups',
  'stg_items',
  'stg_material_costs',
  'stg_part_mappings',
  'stg_sales_prices',
  'user_llm_credentials',
  'user_settings',
  'users',
] as const;

export const EXPECTED_EXTENSIONS = ['citext', 'pg_trgm', 'pgcrypto'] as const;
