import 'server-only';

import type { Db } from '@/db';
import {
  parseAuditFilterParams,
  filterToQuery as auditFilterToQuery,
} from '@/features/audit/filter';
import { normalizeCostViewQuery } from '@/features/costs/view-state';
import { NOTICES_ADMIN_FILTER_DEFS, NOTICES_ADMIN_SORT_IDS } from '@/features/notices/table-state';
import { PARTS_MAPPING_FILTER_DEFS, PARTS_MAPPING_SORT_IDS } from '@/features/parts/table-state';
import { priceFilterDefs } from '@/features/pricing/column-filters';
import {
  filterToQuery as priceFilterToQuery,
  parsePriceFilter,
  priceSortIds,
} from '@/features/pricing/filter';
import { normalizeProcurementItemsQuery } from '@/features/procurement/items/view-state';
import { USERS_FILTER_DEFS, USERS_SORT_IDS } from '@/features/users/table-state';
import { hasPermission, type Role } from '@/lib/constants/permissions';
import { normalizeAdminDeliveriesQuery } from '@/lib/procurement/admin-deliveries-filter';
import { normalizeAdminItemsQuery } from '@/lib/procurement/admin-items-filter';
import { parseProcurementAdminTab } from '@/lib/procurement/admin-tabs';
import { bidFilterToQuery, parseBidFilter } from '@/lib/procurement/bid-filter';
import { normalizePerformanceQuery } from '@/lib/procurement/performance-filter';
import { PAGE_PERMISSIONS, stripQueryPrefix, type PageKey } from '@/lib/page-state/keys';
import { parseFilterParams, withFiltersQuery, type ColumnFilterDef } from '@/lib/table/filter';
import { parseSortParams, withSortQuery } from '@/lib/table/sort-param';
import { listProductFamilies } from '@/server/parts/catalog';
import { listPriceCurrencies, listPriceTypes } from '@/server/pricing/queries';

/**
 * 조회 상태 정규화 (page-state-memory §2.2-3·4·§2.7-1) — 저장 전과 복원 전에 **같은** 함수를 통과시킨다.
 * 각 화면이 URL 을 읽는 기존 파서(zod `.catch`·열 필터·정렬 화이트리스트)로 파싱한 뒤 그 화면의 직렬화로 다시 쓴다.
 * - 화이트리스트 밖 키·값, 권한 밖 열(가격 변동 등)은 여기서 사라진다. 결과는 '?' 없는 쿼리('' = 빈 상태).
 * - 그 화면을 열 권한이 없으면 항상 '' (권한 강등 뒤 복원 미적용).
 * - 데이터에서 나오는 선택지(통화·단가 유형·제품군)는 현재 DB 기준으로 다시 확인한다.
 */
export type Params = Record<string, string | string[] | undefined>;

export type ViewStateActor = { role: Role };

/** URLSearchParams·쿼리 문자열 → 파서 입력(같은 키 여러 개는 배열) */
export function toParams(input: URLSearchParams | string | Params): Params {
  if (typeof input !== 'string' && !(input instanceof URLSearchParams)) return input;
  const source = typeof input === 'string' ? new URLSearchParams(stripQueryPrefix(input)) : input;
  const out: Params = {};
  for (const [key, value] of source) {
    const prev = out[key];
    out[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

/** 파라미터가 하나라도 있는가 — 복원은 파라미터 없는 진입에서만 한다(§2.2-4) */
export function hasParams(params: Params): boolean {
  return Object.values(params).some((value) => value !== undefined);
}

function first(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** 클라이언트 표(사용자·공지·파츠 매핑): 열 필터 + 정렬만, 앞쪽에 고정 파라미터(파츠의 family) */
function clientTableQuery(
  params: Params,
  defs: Readonly<Record<string, ColumnFilterDef>>,
  sortIds: readonly string[],
  head: Readonly<Record<string, string | undefined>> = {},
): string {
  const base = new URLSearchParams();
  for (const [key, value] of Object.entries(head)) if (value) base.set(key, value);
  const filtered = withFiltersQuery(base.toString(), parseFilterParams(params, defs));
  return stripQueryPrefix(withSortQuery(filtered, parseSortParams(params, sortIds)));
}

async function pricingQuery(db: Db, params: Params, withPriceChange: boolean): Promise<string> {
  const [currencies, priceTypes] = await Promise.all([listPriceCurrencies(db), listPriceTypes(db)]);
  const { filter } = parsePriceFilter(
    params,
    priceFilterDefs(currencies, priceTypes, { withPriceChange }),
    priceSortIds(withPriceChange),
  );
  return stripQueryPrefix(priceFilterToQuery(filter));
}

async function partsQuery(db: Db, params: Params): Promise<string> {
  const families = await listProductFamilies(db);
  const raw = first(params, 'family');
  const family = raw && families.includes(raw) ? raw : undefined;
  return clientTableQuery(params, PARTS_MAPPING_FILTER_DEFS, PARTS_MAPPING_SORT_IDS, { family });
}

/** 계산기는 탭만 (`?tab=margin`, 기본 견적 탭은 생략). 챗봇 견적 시작 링크의 family·item 은 일회성이라 저장하지 않는다 */
function calculatorQuery(params: Params): string {
  return first(params, 'tab') === 'margin' ? 'tab=margin' : '';
}

/**
 * 조달 관리 (`/admin/procurement`, Plan msg_9f2035d66cd8): 탭마다 자기 정규화 — 다른 탭의 조건은 저장하지 않는다.
 * 기본 탭(실적 관리)만이면 생략. UI-6(실적)·UI-7(품목)은 각자 case 에서 탭 조건 정규화를 더한다.
 */
function adminProcurementQuery(params: Params): string {
  const tab = parseProcurementAdminTab(first(params, 'tab'));
  switch (tab) {
    case 'deliveries':
      return normalizeAdminDeliveriesQuery(params);
    case 'items':
      return normalizeAdminItemsQuery(params);
    case 'keywords':
      // 키워드 관리는 탭 안 조건이 없다
      return 'tab=keywords';
  }
}

export async function normalizeViewQuery(
  db: Db,
  actor: ViewStateActor,
  pageKey: PageKey,
  input: URLSearchParams | string | Params,
): Promise<string> {
  if (!hasPermission(actor.role, PAGE_PERMISSIONS[pageKey])) return '';
  const params = toParams(input);
  switch (pageKey) {
    case 'pricing':
      return pricingQuery(db, params, false);
    case 'admin-policies':
      // 가격 변동 열 필터·정렬 = 관리 화면 + pricing.write (PricingSection 과 같은 판정)
      return pricingQuery(db, params, hasPermission(actor.role, 'pricing.write'));
    case 'admin-costs':
      return normalizeCostViewQuery(db, params);
    case 'admin-audit':
      return stripQueryPrefix(auditFilterToQuery(parseAuditFilterParams(params)));
    case 'admin-users':
      return clientTableQuery(params, USERS_FILTER_DEFS, USERS_SORT_IDS);
    case 'admin-notices':
      return clientTableQuery(params, NOTICES_ADMIN_FILTER_DEFS, NOTICES_ADMIN_SORT_IDS);
    case 'admin-parts':
      return partsQuery(db, params);
    case 'calculator':
      return calculatorQuery(params);
    // 조달 실적 현황 (UI-5): 화면과 같은 파서·직렬화(탭·세부 그룹·기간·기준월·고른 달·계약 페이지·강조 제조사, 기본값 생략)
    case 'procurement':
      return normalizePerformanceQuery(params);
    // 등록 품목 (UI-2): 검색·열 필터·정렬·페이지 — 조달 격리 때문에 features/procurement 의 정규화를 쓴다
    case 'procurement-items':
      return normalizeProcurementItemsQuery(db, params);
    // 입찰 공고 (UI-3): 화면과 같은 파서·직렬화(제품·마감 포함·상만·정렬·페이지, 기본값 생략)
    case 'procurement-bids':
      return stripQueryPrefix(bidFilterToQuery(parseBidFilter(params)));
    case 'admin-procurement':
      return adminProcurementQuery(params);
  }
}
