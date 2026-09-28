import type { CostFilterView } from './types';

/** 필터 → 쿼리스트링 (클라이언트용 — 서버 모듈 filter.ts 와 같은 규칙) */
export function costFilterToQuery(filter: Partial<CostFilterView>): string {
  const params = new URLSearchParams();
  if (filter.family) params.set('family', filter.family);
  if (filter.dateMode === 'period') params.set('dateMode', 'period');
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.q) params.set('q', filter.q);
  if (filter.page && filter.page > 1) params.set('page', String(filter.page));
  const query = params.toString();
  return query ? `?${query}` : '';
}
