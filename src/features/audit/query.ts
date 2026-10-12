import { appendSortParams } from '@/lib/table/sort-param';
import type { AuditFilter } from '@/server/audit/queries';

/** 필터 → 쿼리스트링 (빈 값·1페이지는 생략해 URL 을 짧게 유지). sort·dir 는 맨 뒤 (#32 §3) */
export function filterToQuery(filter: AuditFilter): string {
  const params = new URLSearchParams();
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.action) params.set('action', filter.action);
  if (filter.actor) params.set('actor', filter.actor);
  if (filter.page > 1) params.set('page', String(filter.page));
  const query = params.toString();
  return appendSortParams(query ? `?${query}` : '', filter.sort);
}
