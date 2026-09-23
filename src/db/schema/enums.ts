import { pgEnum } from 'drizzle-orm/pg-core';

/** 스펙 §4.3 의 enum 정의. DB 타입명은 snake_case, 값은 스펙 원문 그대로 */

/** 행 출처: ERP 임포트 vs 관리 화면 수동 등록 */
export const sourceKindEnum = pgEnum('source_kind', ['erp', 'manual']);

/** §4.4.3 운영상태 (파생) */
export const operationStatusEnum = pgEnum('operation_status', ['운영중', '미사용']);

/** 품목조회 파일의 품목상태 (§4.3.2) */
export const itemStatusEnum = pgEnum('item_status', ['임시', '폐기', '사용']);

/** 계산기 STEP 구분용 품목 종류 (§4.3.2, 파생) */
export const itemKindEnum = pgEnum('item_kind', ['본품', '파츠', '결합형', '서비스', '기타']);

/** 임포트 파일 종류 (§4.3.3) */
export const importKindEnum = pgEnum('import_kind', [
  'sales_price',
  'item_master',
  'material_cost',
  'part_mapping',
]);

/** 임포트 배치 상태 (§4.3.3) */
export const importStatusEnum = pgEnum('import_status', [
  'parsed',
  'failed',
  'applied',
  'superseded',
]);

/** 가격정책 적용 실행 상태 (§4.3.3) */
export const applyRunStatusEnum = pgEnum('apply_run_status', ['running', 'succeeded', 'failed']);

/** 견적 상태 (§4.3.8) */
export const quoteStatusEnum = pgEnum('quote_status', ['draft', 'saved']);

/** 견적 라인 종류 (§4.3.8) */
export const quoteLineKindEnum = pgEnum('quote_line_kind', ['item', 'group']);

/** 사용자 역할 (§4.3.10). 권한 매트릭스는 코드 상수 PERMISSIONS 로 관리 */
export const userRoleEnum = pgEnum('user_role', ['USER', 'ADMIN']);

/** 사용자 상태 (§4.3.10) */
export const userStatusEnum = pgEnum('user_status', ['active', 'inactive']);

/** 사용자 생성 경로 (§4.3.10, §4.6.1) */
export const createdViaEnum = pgEnum('created_via', ['bootstrap', 'auto', 'admin']);

/** 감사 로그 결과 (§4.3.10) */
export const auditResultEnum = pgEnum('audit_result', ['success', 'denied', 'error']);
