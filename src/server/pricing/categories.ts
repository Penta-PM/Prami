import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db';
import { items, salesPrices } from '@/db/schema';
import { productFamilyMajors } from '@/lib/constants/product-cards';
import { sortFamilies } from '@/server/parts/catalog';

/**
 * getCategoryOptions (PRAMI-003 §4.2.5, R-01). 소스 = **판매단가가 1행 이상 있는 품목**의 대/중/소분류(실데이터).
 * 판매단가가 없는 품목만 있는 분류는 조회 결과가 0건이라 선택지에서 뺀다(Q-12).
 * 마스터에 없는(stub) 품번이 있으면 그 제품군을 대분류 fallback 으로 추가한다(이관 후 0건).
 * 품목 마스터가 아예 없으면 대분류 = 판매단가 제품군, 중/소분류 선택지 없음.
 * 정렬: 대분류 = 홈 카드 순서, 중·소분류 = 한국어 로캘.
 */
export type CategoryOptions = {
  majors: string[];
  mids: string[];
  minors: string[];
  /** 품목 마스터 분류가 있는지 — false 면 UI 가 중/소분류 비활성 안내를 띄운다 */
  hasMaster: boolean;
};

const HAS_SALES = sql`exists (select 1 from ${salesPrices} sp
  where sp.item_code = ${items.itemCode} and sp.deleted_at is null)`;

const koSort = (values: readonly string[]) => [...values].sort((a, b) => a.localeCompare(b, 'ko'));

async function distinctValues(
  db: Db,
  column: typeof items.categoryMajor | typeof items.categoryMid | typeof items.categoryMinor,
  ...conditions: SQL[]
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: column })
    .from(items)
    .where(and(eq(items.source, 'master'), HAS_SALES, ...conditions));
  return rows.map((row) => row.value).filter((value): value is string => value !== null);
}

async function salesFamilies(db: Db, onlyStub: boolean): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: salesPrices.productFamily })
    .from(salesPrices)
    .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
    .where(
      and(
        isNull(salesPrices.deletedAt),
        onlyStub ? sql`(${items.source} is null or ${items.source} = 'stub')` : undefined,
      ),
    )
    .orderBy(asc(salesPrices.productFamily));
  return rows.map((row) => row.value);
}

/** 홈 카드(family) 진입이면 그 카드의 대분류만 (iSIGN → iSIGN·iSIGN PKI, PRAMI-001 §4.5.4 r5 · AC-308) */
function withinFamily(majors: readonly string[], family: string | undefined): string[] {
  const allowed = family ? productFamilyMajors(family) : null;
  return allowed ? majors.filter((major) => allowed.includes(major)) : [...majors];
}

export async function getCategoryOptions(
  db: Db,
  selection: { major?: string; mid?: string; family?: string },
): Promise<CategoryOptions> {
  const masterMajors = await distinctValues(db, items.categoryMajor);
  if (masterMajors.length === 0) {
    const majors = withinFamily(await salesFamilies(db, false), selection.family);
    return { majors, mids: [], minors: [], hasMaster: false };
  }
  const fallback = await salesFamilies(db, true);
  const majors = withinFamily(
    sortFamilies([...new Set([...masterMajors, ...fallback])]),
    selection.family,
  );
  const mids = selection.major
    ? koSort(await distinctValues(db, items.categoryMid, eq(items.categoryMajor, selection.major)))
    : [];
  const minors =
    selection.major && selection.mid
      ? koSort(
          await distinctValues(
            db,
            items.categoryMinor,
            eq(items.categoryMajor, selection.major),
            eq(items.categoryMid, selection.mid),
          ),
        )
      : [];
  return { majors, mids, minors, hasMaster: true };
}
