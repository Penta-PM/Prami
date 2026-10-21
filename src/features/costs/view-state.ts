import 'server-only';

import type { Db } from '@/db';
import { optionalCostReadAccess } from '@/server/cost/access';
import { costFilterToQuery, parseCostFilter } from '@/server/cost/filter';
import { listCostCurrencies } from '@/server/cost/queries';

import { costFilterDefs } from './column-filters';

type Params = Record<string, string | string[] | undefined>;

/**
 * 원가 관리(/admin/costs) 조회 상태 정규화 (page-state-memory §2.2-3·4). 페이지와 같은 파서·화이트리스트(통화 = 데이터)를 통과한
 * 쿼리만 남긴다('?' 없음). 세션 사용자에게 cost.read 가 없으면 빈 쿼리 — 권한 강등 뒤 복원하지 않는다(§2.7-1).
 * 원가 모듈 격리(AC-42) 때문에 server/page-state 가 아니라 features/costs 에 둔다.
 */
export async function normalizeCostViewQuery(db: Db, params: Params): Promise<string> {
  const access = await optionalCostReadAccess();
  if (!access) return '';
  const currencies = await listCostCurrencies(access, db);
  const { filter } = parseCostFilter(params, costFilterDefs(currencies));
  const query = costFilterToQuery(filter);
  return query.startsWith('?') ? query.slice(1) : query;
}
