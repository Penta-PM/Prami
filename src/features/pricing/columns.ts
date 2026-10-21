/**
 * 가격정책 표 공통 컬럼 정의 (§4.5.3, R-03·R-04·R-09·R-12). 순서 고정 — 조회·관리 표가 같은 배열을 쓴다.
 * 관리 표 = 조회 표 + 적용시작일(판매가 뒤) + 운영 연도(적용기간 뒤) + 관리(끝) (AC-12).
 * 가격 변동(cost-ratio-price-change §2.4)은 운영 연도 뒤·품목상태 앞 — **관리 표이고 pricing.write 일 때만**
 *   (pricing-view-hide-price-change §1, columnsFor(mode, withCost, withPriceChange)). 조회 표(/pricing)에는 열 정의 자체가 없다.
 * 원가 비중(§2.2·§2.3)은 판매가 뒤 — 관리 표이고 pricing.write + cost.read 일 때만(columnsFor(mode, withCost)).
 * 원가 매핑(policy-cost-link-column §2.1)은 원가 비중 바로 왼쪽 — 원가 비중과 같은 판정(withCost).
 */
export type PriceColumnKey =
  | 'priceType'
  | 'major'
  | 'mid'
  | 'minor'
  | 'itemName'
  | 'price'
  | 'costLink'
  | 'costRatio'
  | 'effectiveFrom'
  | 'period'
  | 'operationYears'
  | 'priceChange'
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
  /** 원가 열 — 관리 표에서 pricing.write + cost.read 일 때만 (cost-ratio-price-change §2.3) */
  cost?: boolean;
  /** 가격 변동 열 — 관리 표에서 pricing.write 일 때만 (pricing-view-hide-price-change §1) */
  priceChange?: boolean;
};

export const PRICE_TABLE_COLUMNS: readonly PriceColumn[] = [
  { key: 'priceType', label: '단가 유형', view: true, admin: true, align: 'left' },
  { key: 'major', label: '대분류', view: true, admin: true, align: 'left' },
  { key: 'mid', label: '중분류', view: true, admin: true, align: 'left' },
  { key: 'minor', label: '소분류', view: true, admin: true, align: 'left' },
  { key: 'itemName', label: '품목명', view: true, admin: true, align: 'left' },
  { key: 'price', label: '판매가', view: true, admin: true, align: 'right' },
  // 원가 매핑: 원가 비중 바로 왼쪽(원인 → 결과), 원가 비중과 같은 판정(열 정의 자체가 없음 — RSC payload 에 키 0)
  { key: 'costLink', label: '원가 매핑', view: false, admin: false, cost: true, align: 'left' },
  // 원가 비중: 판매가 뒤, 관리 표 + cost.read 일 때만(열 정의 자체가 없음 — RSC payload 에 키 0)
  { key: 'costRatio', label: '원가 비중', view: false, admin: false, cost: true, align: 'right' },
  { key: 'effectiveFrom', label: '적용시작일', view: false, admin: true, align: 'center' },
  { key: 'period', label: '적용기간', view: true, admin: true, align: 'center' },
  { key: 'operationYears', label: '운영 연도', view: false, admin: true, align: 'center' },
  // 가격 변동: 관리 표 + pricing.write 일 때만(조회 표는 열 정의 자체가 없음 — RSC payload 에 키 0)
  {
    key: 'priceChange',
    label: '가격 변동',
    view: false,
    admin: false,
    priceChange: true,
    align: 'left',
  },
  { key: 'itemStatus', label: '품목상태', view: true, admin: true, align: 'center' },
  { key: 'status', label: '상태', view: true, admin: true, align: 'left' },
  { key: 'remark', label: '비고', view: true, admin: true, align: 'left' },
  { key: 'actions', label: '관리', view: false, admin: true, align: 'right', pinned: 'end' },
];

export type TableMode = 'view' | 'admin';

/**
 * 열 묶음: 조회 = view 열만. 관리 = admin 열 + 원가 비중(withCost) + 가격 변동(withPriceChange).
 * 같은 tableId — 저장 레이아웃 정규화가 새 열을 기본 위치에 끼우고 없는 열 id 는 버린다.
 */
type ColumnSet = 'view' | `admin:${boolean}:${boolean}`;

const columnSet = (mode: TableMode, withCost: boolean, withPriceChange: boolean): ColumnSet =>
  mode === 'admin' ? `admin:${withCost}:${withPriceChange}` : 'view';

const BY_SET = new Map<ColumnSet, readonly PriceColumn[]>();
const LAYOUT_BY_SET = new Map<ColumnSet, readonly { id: string; pinned?: 'end' }[]>();

function columnsOf(set: ColumnSet): readonly PriceColumn[] {
  let columns = BY_SET.get(set);
  if (!columns) {
    const [, cost, change] = set.split(':');
    columns =
      set === 'view'
        ? PRICE_TABLE_COLUMNS.filter((column) => column.view)
        : PRICE_TABLE_COLUMNS.filter(
            (column) =>
              column.admin ||
              (column.cost === true && cost === 'true') ||
              (column.priceChange === true && change === 'true'),
          );
    BY_SET.set(set, columns);
  }
  return columns;
}

/**
 * 모드별 컬럼 — 같은 조합이면 같은 배열 참조를 돌려준다(열 레이아웃 저장소의 기준 배열로 쓰임).
 * withPriceChange 기본 = false(가격 변동 열 없음 — 서버 판정 값을 넘긴다). 조회 표는 값과 관계없이 가격 변동 열이 없다.
 */
export function columnsFor(
  mode: TableMode,
  withCost = false,
  withPriceChange = false,
): readonly PriceColumn[] {
  return columnsOf(columnSet(mode, withCost, withPriceChange));
}

/**
 * 열 너비·순서 저장 키의 표 구분자 (#32 스펙 §5) — 가격 조회와 가격 관리는 다른 tableId 를 쓴다.
 * 정렬 가능한 열의 id 는 서버 정렬 화이트리스트(PRICE_SORT_IDS)와 같은 PriceColumnKey 다.
 */
export const PRICE_TABLE_IDS: Record<TableMode, string> = {
  view: 'pricing-view',
  admin: 'pricing-manage',
};

/** '열 초기화' 버튼이 표와 같은 저장값을 구독하도록 넘길 열 목록 (id·고정 여부만) */
export function layoutColumnsFor(
  mode: TableMode,
  withCost = false,
  withPriceChange = false,
): readonly { id: string; pinned?: 'end' }[] {
  const set = columnSet(mode, withCost, withPriceChange);
  let layout = LAYOUT_BY_SET.get(set);
  if (!layout) {
    layout = columnsOf(set).map(({ key, pinned }) => ({ id: key, pinned }));
    LAYOUT_BY_SET.set(set, layout);
  }
  return layout;
}
