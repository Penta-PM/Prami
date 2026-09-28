import { sql } from 'drizzle-orm';

import type { DuplicateGroup } from '@/lib/imports/duplicates';

import { queryRows, type Executor } from './sql-rows';

/**
 * 업로드 미리보기용 — 스테이징된 원가 배치에서 같은 계열·같은 적용시작일 그룹을 뽑는다 (§4.4.7 r4 3).
 * sourceRows 는 원본 데이터 행 번호(헤더 다음 행 = 1) 오름차순, unitCosts 는 같은 순서.
 */
export async function listStagedCostDuplicateGroups(
  executor: Executor,
  batchId: string,
  headerRowIndex: number,
): Promise<DuplicateGroup[]> {
  return queryRows<DuplicateGroup>(
    executor,
    sql`
    select s.material_code || '|' || s.price_type || '|' || s.price_category || '|' || s.currency as "seriesKey",
           s.effective_from::text as "effectiveFrom",
           array_agg(s.row_index - ${headerRowIndex} - 1 order by s.row_index) as "sourceRows",
           array_agg(s.unit_cost::text order by s.row_index) as "unitCosts"
    from stg_material_costs s
    where s.batch_id = ${batchId}
    group by 1, 2
    having count(*) > 1
    order by 1, 2`,
  );
}
