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
  /** 관리(비데이터) 열 — 정렬·재배치하지 않고 끝에 고정 (#32 스펙 §4) */
  pinned?: 'end';
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
  { key: 'actions', label: '관리', view: false, admin: true, align: 'right', pinned: 'end' },
];

export type TableMode = 'view' | 'admin';

const BY_MODE: Record<TableMode, readonly PriceColumn[]> = {
  view: PRICE_TABLE_COLUMNS.filter((column) => column.view),
  admin: PRICE_TABLE_COLUMNS.filter((column) => column.admin),
};

/** 모드별 컬럼 — 같은 배열 참조를 돌려준다(열 레이아웃 저장소의 기준 배열로 쓰임) */
export function columnsFor(mode: TableMode): readonly PriceColumn[] {
  return BY_MODE[mode];
}

/**
 * 열 너비·순서 저장 키의 표 구분자 (#32 스펙 §5) — 가격 조회와 가격 관리는 다른 tableId 를 쓴다.
 * 정렬 가능한 열의 id 는 서버 정렬 화이트리스트(PRICE_SORT_IDS)와 같은 PriceColumnKey 다.
 */
export const PRICE_TABLE_IDS: Record<TableMode, string> = {
  view: 'pricing-view',
  admin: 'pricing-manage',
};

const LAYOUT_BY_MODE: Record<TableMode, readonly { id: string; pinned?: 'end' }[]> = {
  view: BY_MODE.view.map(({ key, pinned }) => ({ id: key, pinned })),
  admin: BY_MODE.admin.map(({ key, pinned }) => ({ id: key, pinned })),
};

/** '열 초기화' 버튼이 표와 같은 저장값을 구독하도록 넘길 열 목록 (id·고정 여부만) */
export function layoutColumnsFor(mode: TableMode): readonly { id: string; pinned?: 'end' }[] {
  return LAYOUT_BY_MODE[mode];
}
