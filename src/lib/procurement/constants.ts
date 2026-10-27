/**
 * 조달 화면·조회 공용 상수 (조달이 통합). 순수 모듈 — procurement 스키마를 import 하지 않으므로 어디서나 쓸 수 있다.
 * 값은 DB CHECK·트리거(0012)와 같다.
 */

/** 통계 대상 제품 (items.product 중 '기타' 제외 — v_product_deliveries 와 같은 범위) */
export const PROCUREMENT_PRODUCTS = ['WAPPLES', 'D.AMO', 'iSIGN'] as const;
export type ProcurementProduct = (typeof PROCUREMENT_PRODUCTS)[number];

/** items.product 전체 (미분류 '기타' 포함) */
export const PROCUREMENT_ITEM_PRODUCTS = [...PROCUREMENT_PRODUCTS, '기타'] as const;

/** 실적 현황 제품 탭 */
export const PROCUREMENT_PRODUCT_TABS = ['ALL', ...PROCUREMENT_PRODUCTS] as const;
export type ProcurementProductTab = (typeof PROCUREMENT_PRODUCT_TABS)[number];

/** iSIGN 세부 그룹 (트리거 items_before_write 가 계산하는 product_group 값, 순서 = 화면 순서) */
export const ISIGN_PRODUCT_GROUPS = ['SSO', 'WA', 'PASS', 'OS 로그온', '기타'] as const;
export type IsignProductGroup = (typeof ISIGN_PRODUCT_GROUPS)[number];

/** 입찰 공고 적합도 등급 (높은 것부터) */
export const BID_FIT_GRADES = ['상', '중', '하'] as const;
export type BidFitGrade = (typeof BID_FIT_GRADES)[number];

/** 자사 제조사 판정은 our-company.ts (설정 가능한 회사명 목록) — 기존 import 경로 유지용 재노출 */
export { OUR_COMPANY_NAMES, isOurManufacturer } from './our-company';

/** 수집 작업 이름 (job_runs.job) 과 상태 키 (app_state.key) — 원본 DDL 주석 기준 */
export const PROCUREMENT_JOBS = ['daily', 'bids'] as const;
export type ProcurementJob = (typeof PROCUREMENT_JOBS)[number];

export const PROCUREMENT_STATE_KEYS = {
  /** 마지막으로 메일 보고한 기준일 */
  dailyLastEndDate: 'daily.last_end_date',
  /** 마지막 입찰공고 확인 시각 */
  bidsLastChecked: 'bids.last_checked',
} as const;
