import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { Db } from '@/db';
import { items, salesPrices } from '@/db/schema';

/**
 * getCategoryOptions (§4.5.1, R-01). 소스는 items 의 대/중/소분류.
 * items 에 대분류가 하나도 없으면(품목조회 파일 미적용) 대분류 = 판매단가 제품군, 중/소분류는 선택지 없음.
 */
export type CategoryOptions = {
  majors: string[];
  mids: string[];
  minors: string[];
  /** 품목 마스터 분류가 있는지 — false 면 UI 가 중/소분류 비활성 안내를 띄운다 */
  hasMaster: boolean;
};

async function distinctValues(
  db: Db,
  column: typeof items.categoryMajor | typeof items.categoryMid | typeof items.categoryMinor,
  ...conditions: ReturnType<typeof eq>[]
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: column })
    .from(items)
    .where(and(isNotNull(column), ...conditions))
    .orderBy(asc(column));
  return rows.map((row) => row.value).filter((value): value is string => value !== null);
}

export async function getCategoryOptions(
  db: Db,
  selection: { major?: string; mid?: string },
): Promise<CategoryOptions> {
  const masterMajors = await distinctValues(db, items.categoryMajor);
  if (masterMajors.length === 0) {
    const families = await db
      .selectDistinct({ value: salesPrices.productFamily })
      .from(salesPrices)
      .where(isNull(salesPrices.deletedAt))
      .orderBy(asc(salesPrices.productFamily));
    return { majors: families.map((row) => row.value), mids: [], minors: [], hasMaster: false };
  }
  // 품목 마스터가 있어도 마스터에 없는(stub) 품번은 제품군이 대분류가 되므로 제품군도 후보에 넣는다
  const fallback = await db
    .selectDistinct({ value: salesPrices.productFamily })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(and(isNull(salesPrices.deletedAt), sql`${items.categoryMajor} is null`));
  const majors = [...new Set([...masterMajors, ...fallback.map((row) => row.value)])].sort();
  const mids = selection.major
    ? await distinctValues(db, items.categoryMid, eq(items.categoryMajor, selection.major))
    : [];
  const minors =
    selection.major && selection.mid
      ? await distinctValues(
          db,
          items.categoryMinor,
          eq(items.categoryMajor, selection.major),
          eq(items.categoryMid, selection.mid),
        )
      : [];
  return { majors, mids, minors, hasMaster: true };
}
