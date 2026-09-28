import { asc, eq, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { items, partMappings } from '@/db/schema';

/** "등록된 매핑" 표 한 행 = 모델 1건 + 파츠 목록 (§4.3.6 GROUP BY model_item_code, R-02) */
export type PartMappingGroup = {
  modelItemCode: string;
  modelName: string;
  productFamily: string | null;
  parts: { itemCode: string; itemName: string }[];
};

const MODEL_FAMILY_SQL = sql<string | null>`(
  select sp.product_family from sales_prices sp
  where sp.item_code = ${partMappings.modelItemCode} and sp.deleted_at is null
  order by sp.effective_from desc limit 1)`;

/** 모델별로 그룹화한 매핑 목록. family 를 주면 그 제품군 모델만 */
export async function listPartMappings(db: Db, family?: string): Promise<PartMappingGroup[]> {
  const rows = await db
    .select({
      modelItemCode: partMappings.modelItemCode,
      modelName: sql<string>`(select i.item_name from items i where i.item_code = ${partMappings.modelItemCode})`,
      productFamily: MODEL_FAMILY_SQL,
      partItemCode: partMappings.partItemCode,
      partName: items.itemName,
      sortOrder: partMappings.sortOrder,
    })
    .from(partMappings)
    .innerJoin(items, eq(items.itemCode, partMappings.partItemCode))
    .orderBy(asc(partMappings.modelItemCode), asc(partMappings.sortOrder), asc(partMappings.id));
  const groups = new Map<string, PartMappingGroup>();
  for (const row of rows) {
    if (family && row.productFamily !== family) continue;
    const group = groups.get(row.modelItemCode) ?? {
      modelItemCode: row.modelItemCode,
      modelName: row.modelName,
      productFamily: row.productFamily,
      parts: [],
    };
    group.parts.push({ itemCode: row.partItemCode, itemName: row.partName });
    groups.set(row.modelItemCode, group);
  }
  return [...groups.values()].sort((a, b) => a.modelName.localeCompare(b.modelName, 'ko'));
}

/** 특정 모델에 이미 매핑이 있는지 (AC-31 경고) */
export async function getPartMapping(db: Db, modelItemCode: string): Promise<string[]> {
  const rows = await db
    .select({ code: partMappings.partItemCode })
    .from(partMappings)
    .where(eq(partMappings.modelItemCode, modelItemCode))
    .orderBy(asc(partMappings.sortOrder), asc(partMappings.id));
  return rows.map((row) => row.code);
}
