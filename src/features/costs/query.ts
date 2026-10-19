import { serializeFilters } from '@/lib/table/filter';
import { appendSortParams } from '@/lib/table/sort-param';

import type { CostFilterView } from './types';

/**
 * 필터 → 쿼리스트링 (클라이언트·서버 공용 — 서버 filter.ts 가 이 함수를 쓴다). 기본값·1페이지는 생략,
 * 열 필터 `f.*` 는 기존 필터 뒤·page 앞, sort·dir 는 맨 뒤 (#32 §3)
 */
export function costFilterToQuery(filter: Partial<CostFilterView>): string {
  const params = new URLSearchParams();
  if (filter.family) params.set('family', filter.family);
  if (filter.dateMode === 'period') params.set('dateMode', 'period');
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.q) params.set('q', filter.q);
  for (const [key, value] of serializeFilters(filter.filters ?? [])) params.append(key, value);
  if (filter.page && filter.page > 1) params.set('page', String(filter.page));
  const query = params.toString();
  return appendSortParams(query ? `?${query}` : '', filter.sort);
}

/**
 * 기존 필터(기간·검색) 또는 열 필터가 걸렸는가 — 정렬 제외. 빈 상태 구분·'필터 초기화' 노출(Plan Q1 B).
 * 제품군 탭은 화면 이동(필터 아님)이라 세지 않는다 — '필터 초기화' 도 탭은 유지한다 (§7 Q5)
 */
export function isCostFiltered(filter: Partial<CostFilterView>): boolean {
  return Boolean(
    filter.dateMode === 'period' ||
    filter.from ||
    filter.to ||
    filter.q ||
    (filter.filters && filter.filters.length > 0),
  );
}
