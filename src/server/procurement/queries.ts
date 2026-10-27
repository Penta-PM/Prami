/**
 * 조달 조회 계층 (조달이 통합 DB-2) — 화면별 조회 함수의 입구. 모든 함수는 ProcurementAccess 토큰을 첫 인자로 받고
 * 첫 줄에서 검사한다(원가 패턴). 집계·정렬·필터·페이지네이션은 SQL — 브라우저에 전량을 내리지 않는다.
 * 이 모듈(server/procurement)과 procurement 스키마는 조달 경로에서만 import 할 수 있다(ESLint 격리 규칙).
 *
 * - 등록 품목 (UI-2): items.ts
 * - 입찰 공고 (UI-3): bids.ts
 * - 조달 실적 현황 (UI-5): performance.ts
 * - 마지막 수집 시각 (공용 헤더): collection.ts
 */
export {
  PROCUREMENT_ITEM_EXPORT_LIMIT,
  PROCUREMENT_ITEM_SORT_IDS,
  getProcurementItemFacets,
  getProcurementItemPriceRange,
  getProcurementItemRows,
  getProcurementItemRowsForExport,
  type FacetOption,
  type ProcurementItemFacets,
  type ProcurementItemFilter,
  type ProcurementItemRow,
  type ProcurementItemSortId,
} from './items';
export {
  BID_SORTS,
  getBidNoticeRows,
  type BidNoticeFilter,
  type BidNoticePage,
  type BidNoticeRow,
  type BidSort,
} from './bids';
export {
  MANUFACTURER_SERIES_TOP,
  getManufacturerPerformance,
  getMonthContracts,
  getMonthVolumes,
  getMonthlyReport,
  getMonthlyReportByManufacturer,
  getMonthlySeries,
  getMonthlySeriesByManufacturer,
  getPerformanceKpis,
  getYearlyPerformance,
  type ManufacturerPerformance,
  type ManufacturerMonthlySeries,
  type ManufacturerPerformanceRow,
  type MonthContractRow,
  type MonthVolume,
  type MonthlyPoint,
  type MonthlyReport,
  type MonthlyReportRow,
  type MonthlySeriesByManufacturer,
  type PerformanceKpis,
  type PerformanceScope,
  type YearlyPerformance,
} from './performance';
export {
  getCollectionStatus,
  type JobCollection,
  type ProcurementCollectionStatus,
} from './collection';
export { PROCUREMENT_PAGE_SIZE, type MonthKey, type MonthPeriod, type Paged } from './shared';
