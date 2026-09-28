/**
 * 가격정책 표 공통 컬럼 정의 (§4.5.3, R-03·R-04·R-09·R-12). 순서 고정 — 조회·관리 표가 같은 배열을 쓴다.
 * 관리 표 = 조회 표 + 적용시작일(판매가 뒤) + 운영 연도(적용기간 뒤) + 관리(끝) (AC-12).
 */
export type PriceColumnKey =
  | 'priceType'
  | 'major'
  | 'mid'
  | 'minor'
  | 'itemName'
  | 'price'
  | 'effectiveFrom'
  | 'period'
  | 'operationYears'
  | 'itemStatus'
  | 'status'
  | 'remark'
  | 'actions';

export type PriceColumn = {
  key: PriceColumnKey;
  label: string;
  view: boolean;
  admin: boolean;
  align: 'left' | 'center' | 'right';
};

export const PRICE_TABLE_COLUMNS: readonly PriceColumn[] = [
  { key: 'priceType', label: '단가 유형', view: true, admin: true, align: 'left' },
  { key: 'major', label: '대분류', view: true, admin: true, align: 'left' },
  { key: 'mid', label: '중분류', view: true, admin: true, align: 'left' },
  { key: 'minor', label: '소분류', view: true, admin: true, align: 'left' },
  { key: 'itemName', label: '품목명', view: true, admin: true, align: 'left' },
  { key: 'price', label: '판매가', view: true, admin: true, align: 'right' },
  { key: 'effectiveFrom', label: '적용시작일', view: false, admin: true, align: 'center' },
  { key: 'period', label: '적용기간', view: true, admin: true, align: 'center' },
  { key: 'operationYears', label: '운영 연도', view: false, admin: true, align: 'center' },
  { key: 'itemStatus', label: '품목상태', view: true, admin: true, align: 'center' },
  { key: 'status', label: '상태', view: true, admin: true, align: 'left' },
  { key: 'remark', label: '비고', view: true, admin: true, align: 'left' },
  { key: 'actions', label: '관리', view: false, admin: true, align: 'right' },
];

export type TableMode = 'view' | 'admin';

export function columnsFor(mode: TableMode): readonly PriceColumn[] {
  return PRICE_TABLE_COLUMNS.filter((column) => (mode === 'admin' ? column.admin : column.view));
}
