// 클라이언트(빠른 필터 바·검색)에서도 파싱하므로 JIT(eval) 탐지를 끈 zod 를 쓴다 (CSP, PR-11a QA L-1)
import { z } from '@/lib/zod-jitless';
import {
  FILTER_KEY_RE,
  hasControlChar,
  parseFilterParams,
  serializeFilters,
  splitInValues,
  type ColumnFilterDef,
  type FilterCondition,
  type FilterOption,
} from '@/lib/table/filter';
import { appendSortParams, parseSortParams, type SortState } from '@/lib/table/sort-param';

/**
 * 조달 관리 · 실적 관리 탭(`/admin/procurement?tab=deliveries`, 조달이 통합 UI-6) URL 상태 — 순수 모듈. 화면(클라이언트)·RSC 섹션·
 * 조회 상태 정규화(page_key `admin-procurement`)가 같은 파서·직렬화를 쓴다. URL 이 상태다:
 *
 * - `tab=deliveries` (맨 앞 — 기본 탭이라 조회 상태 정규화에서는 생략), `trash=1` = 휴지통 하위 화면
 * - `q` = 납품요구번호·물품식별번호·물품식별명·수요기관·사업명 검색
 * - `f.<id>.<op>` = 열 필터 (납품요구일자 date·제품 enum·수요기관 text·납품업체 enum). 제품·업체 선택지는 데이터(서버 facets)
 * - `page` (1페이지는 생략), `sort`·`dir` 맨 뒤 (#32 §3)
 *
 * 편집 필드 정의(값 규칙·감사 키)는 features/procurement/admin/deliveries/fields.ts.
 */

/** 실적 관리 하위 화면: 납품요구(제외 안 됨) / 휴지통(excluded = true) */
export const DELIVERY_ADMIN_VIEWS = ['active', 'trash'] as const;
export type DeliveryAdminView = (typeof DELIVERY_ADMIN_VIEWS)[number];

/** 서버 정렬 화이트리스트 (= 표 열 id) — server/procurement/deliveries.ts 가 같은 목록을 쓴다 */
export const DELIVERY_SORT_IDS = [
  'dlvrReqDate',
  'product',
  'demandOrg',
  'vendor',
  'itemId',
  'itemName',
  'quantity',
  'unitPrice',
  'amount',
  'excludedAt',
] as const;
export type DeliverySortId = (typeof DELIVERY_SORT_IDS)[number];

/** 열 필터 id (빠른 필터 바 필드 순서). 고정 필드 = 납품요구일자·제품·납품업체(원본 칸별 필터와 같은 칸) */
export const DELIVERY_FILTER_IDS = ['dlvrReqDate', 'product', 'demandOrg', 'vendor'] as const;
export type DeliveryFilterId = (typeof DELIVERY_FILTER_IDS)[number];
export const DELIVERY_QUICK_FIELDS: readonly DeliveryFilterId[] = [
  'dlvrReqDate',
  'product',
  'vendor',
];

/** 등록 물품과 연결되지 않은 납품요구의 제품 칸·필터 값 */
export const DELIVERY_NO_PRODUCT = '미등록';

export const DELIVERY_PAGE_SIZE = 50;

/** 조회 계층 목록 입력 (구조화 필터 — URL 코덱 parseAdminDeliveriesView 가 검증한 값으로 만든다) */
export type DeliveryListQuery = {
  view: DeliveryAdminView;
  /** 납품요구번호·물품식별번호·물품식별명·수요기관·사업명 부분 일치 */
  q?: string;
  /** 제품 (등록 물품 제품, '미등록' = 연결 없음) */
  products?: readonly string[];
  vendors?: readonly string[];
  /** 수요기관 — '포함'(has) = 부분 일치, '같음'(eq) = 일치. 둘 다 ASCII 대소문자 무시(공용 서버 열 필터와 같은 SQL) */
  demandOrg?: { op: 'has' | 'eq'; value: string };
  /** 납품요구일자 'YYYY-MM-DD' (양 끝 포함) */
  dateFrom?: string;
  dateTo?: string;
  sort?: { id: DeliverySortId; dir: 'asc' | 'desc' };
  page: number;
};

export const ADMIN_PROCUREMENT_PATH = '/admin/procurement';
export const ADMIN_DELIVERIES_TAB = 'deliveries';

export type AdminDeliveriesView = {
  trash: boolean;
  q?: string;
  page: number;
  sort?: SortState<DeliverySortId>;
  filters?: FilterCondition[];
};

export type DeliveryFilterChoices = { products: readonly string[]; vendors: readonly string[] };

export const DELIVERY_FILTER_LABELS: Record<DeliveryFilterId, string> = {
  dlvrReqDate: '납품요구일자',
  product: '제품',
  demandOrg: '수요기관',
  vendor: '납품업체',
};

const options = (values: readonly string[]): FilterOption[] =>
  values.map((value) => ({ value, label: value }));

/** 열 필터 화이트리스트 (키 순서 = 바 필드·URL·칩 순서) */
export function deliveryFilterDefs(
  choices: DeliveryFilterChoices,
): Record<DeliveryFilterId, ColumnFilterDef> {
  return {
    dlvrReqDate: { kind: 'date' },
    product: { kind: 'enum', options: options(choices.products) },
    demandOrg: { kind: 'text' },
    vendor: { kind: 'enum', options: options(choices.vendors) },
  };
}

type Params = Record<string, string | string[] | undefined>;

function first(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * URL 에 적힌 제품·업체 값을 그대로 선택지로 — DB 없이 형식(한도·제어 문자)만 검증할 때(조회 상태 정규화).
 * 화면(RSC 섹션)은 서버 facets 로 다시 걸러 데이터에 없는 값을 버린다.
 */
export function choicesFromParams(params: Params): DeliveryFilterChoices {
  const values = (col: DeliveryFilterId) => {
    const out: string[] = [];
    for (const [key, raw] of Object.entries(params)) {
      const match = FILTER_KEY_RE.exec(key);
      if (!match || match[1] !== col || match[2] !== 'in') continue;
      const last = Array.isArray(raw) ? raw[raw.length - 1] : raw;
      if (last !== undefined) out.push(...(splitInValues(last) ?? []));
    }
    return out;
  };
  return { products: values('product'), vendors: values('vendor') };
}

const searchText = z
  .string()
  .refine((value) => !hasControlChar(value))
  .trim()
  .max(100)
  .transform((value) => (value === '' ? undefined : value))
  .optional()
  .catch(undefined);

const pageNumber = z.coerce.number().int().min(1).max(100_000).catch(1).default(1);

/** URL → 화면 상태. 화이트리스트 밖 키·값은 버린다. choices 를 주지 않으면 URL 값 자체(choicesFromParams)로 enum 을 검증한다 */
export function parseAdminDeliveriesView(
  params: Params,
  choices: DeliveryFilterChoices = choicesFromParams(params),
): AdminDeliveriesView {
  const view: AdminDeliveriesView = {
    trash: first(params, 'trash') === '1',
    page: pageNumber.parse(first(params, 'page')),
  };
  const q = searchText.parse(first(params, 'q'));
  if (q) view.q = q;
  const sort = parseSortParams(params, DELIVERY_SORT_IDS);
  // 삭제 시각 정렬은 휴지통에서만
  if (sort && (view.trash || sort.id !== 'excludedAt')) view.sort = sort;
  const filters = parseFilterParams(params, deliveryFilterDefs(choices));
  if (filters.length > 0) view.filters = filters;
  return view;
}

/** 화면 상태 → 쿼리스트링('?…'). 순서: tab → trash → q → f.* → page(>1) → sort·dir */
export function adminDeliveriesViewToQuery(view: Partial<AdminDeliveriesView>): string {
  const params = new URLSearchParams({ tab: ADMIN_DELIVERIES_TAB });
  if (view.trash) params.set('trash', '1');
  if (view.q) params.set('q', view.q);
  for (const [key, value] of serializeFilters(view.filters ?? [])) params.append(key, value);
  if (view.page && view.page > 1) params.set('page', String(view.page));
  return appendSortParams(`?${params.toString()}`, view.sort);
}

/** 화면 상태 → 이동 href */
export function adminDeliveriesHref(view: Partial<AdminDeliveriesView>): string {
  return `${ADMIN_PROCUREMENT_PATH}${adminDeliveriesViewToQuery(view)}`;
}

/**
 * 조회 상태 정규화 (page-state-memory §2.2-3·4, page_key `admin-procurement` 의 deliveries 탭) — 화면과 같은 파서·직렬화를
 * 통과한 쿼리('?' 없음). 실적 관리는 기본 탭이라 `tab` 은 생략한다(조건이 없으면 ''). DB 를 읽지 않는다(제품·업체 값은 형식만 —
 * 화면이 다시 데이터로 거른다).
 */
export function normalizeAdminDeliveriesQuery(params: Params): string {
  const query = adminDeliveriesViewToQuery(parseAdminDeliveriesView(params)).slice(1);
  const prefix = `tab=${ADMIN_DELIVERIES_TAB}`;
  return query === prefix ? '' : query.replace(`${prefix}&`, '');
}

/** 검색 또는 열 필터가 걸렸는가 (정렬 제외) — 빈 상태 구분·'필터 초기화' 노출 */
export function isAdminDeliveriesFiltered(view: Partial<AdminDeliveriesView>): boolean {
  return Boolean(view.q || (view.filters && view.filters.length > 0));
}

/** 화면 상태 → 조회 계층 입력 (server/procurement getDeliveryAdminRows) */
export function toDeliveryListQuery(view: AdminDeliveriesView): DeliveryListQuery {
  const out: DeliveryListQuery = { view: view.trash ? 'trash' : 'active', page: view.page };
  if (view.q) out.q = view.q;
  if (view.sort) out.sort = view.sort;
  for (const cond of view.filters ?? []) {
    if (cond.op === 'in') {
      if (cond.col === 'product') out.products = cond.values;
      else if (cond.col === 'vendor') out.vendors = cond.values;
      continue;
    }
    if (cond.col === 'dlvrReqDate') {
      if (cond.op === 'gte') out.dateFrom = cond.value;
      else if (cond.op === 'lte') out.dateTo = cond.value;
    } else if (cond.col === 'demandOrg' && (cond.op === 'has' || cond.op === 'eq')) {
      out.demandOrg = { op: cond.op, value: cond.value };
    }
  }
  return out;
}
