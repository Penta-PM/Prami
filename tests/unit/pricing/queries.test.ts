// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { parsePriceFilter } from '@/features/pricing/filter';
import { applyPolicy } from '@/server/imports/apply-policy';
import { queryCount, queryRows } from '@/server/imports/sql-rows';
import { getCategoryOptions } from '@/server/pricing/categories';
import {
  getPriceRowDetail,
  getPriceRows,
  listEffectiveYears,
  PRICE_PAGE_SIZE,
} from '@/server/pricing/queries';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/** §4.5.1~4.5.3 조회 쿼리 — AC-10(날짜 필터 SQL 교차 검증)·AC-11(분류 연쇄)·AC-14/22(품목상태) */
let handle: DbHandle;
let salesBatchId: string;
let itemBatchId: string;

const filter = (params: Record<string, string>) => parsePriceFilter(params).filter;
const ctx = () => ({ handle, actor: TEST_ACTOR, meta: TEST_META });

beforeAll(async () => {
  handle = await createTestDb();
  salesBatchId = (await uploadFixture(handle, 'sales', 'sales-200.xlsx')).batchId;
  itemBatchId = (await uploadFixture(handle, 'items', 'items-v1.xlsx')).batchId;
  await applyPolicy(ctx(), {
    salesBatchId,
    itemBatchId: null,
    salesReused: false,
    itemReused: false,
  });
});

afterAll(async () => {
  await handle.close();
});

describe('AC-11 분류 연쇄 — 품목 마스터 미적용', () => {
  it('대분류 = 제품군, 중/소분류 없음 + hasMaster=false', async () => {
    const families = await queryRows<{ f: string }>(
      handle.db,
      sql`select distinct product_family as f from sales_prices order by 1`,
    );
    expect(await getCategoryOptions(handle.db, {})).toEqual({
      majors: families.map((row) => row.f),
      mids: [],
      minors: [],
      hasMaster: false,
    });
  });
});

describe('AC-10 날짜 필터 (SQL 교차 검증)', () => {
  it('적용시작일 기준 + 연도 칩 → effective_from 이 모두 그 연도, 총건수 일치', async () => {
    const years = await listEffectiveYears(handle.db);
    expect(years).toEqual([...years].sort((a, b) => b - a));
    const year = years.find((value) => value !== years[0]) ?? years[0]!;
    const page = await getPriceRows(
      handle.db,
      filter({ from: `${year}-01-01`, to: `${year}-12-31` }),
    );
    const expected = await queryCount(
      handle.db,
      sql`select count(*)::int as n from sales_prices
          where deleted_at is null and extract(year from effective_from) = ${year}`,
    );
    expect(page.total).toBe(expected);
    expect(page.total).toBeGreaterThan(0);
    expect(page.rows.every((row) => row.effectiveFrom.startsWith(String(year)))).toBe(true);
  });

  it('적용기간 기준 2024-06-01~2024-06-30 → 구간 겹침 조건과 총건수 일치', async () => {
    const page = await getPriceRows(
      handle.db,
      filter({ dateMode: 'period', from: '2024-06-01', to: '2024-06-30' }),
    );
    const expected = await queryCount(
      handle.db,
      sql`select count(*)::int as n from sales_prices where deleted_at is null
          and effective_from <= '2024-06-30' and (effective_to is null or effective_to > '2024-06-01')`,
    );
    expect(page.total).toBe(expected);
    expect(page.total).toBeGreaterThan(0);
  });

  it('한쪽 날짜만 있으면 단방향', async () => {
    const onlyTo = await getPriceRows(handle.db, filter({ to: '2019-12-31' }));
    expect(onlyTo.rows.every((row) => row.effectiveFrom <= '2019-12-31')).toBe(true);
    const onlyFrom = await getPriceRows(
      handle.db,
      filter({ dateMode: 'period', from: '2026-01-01' }),
    );
    expect(
      onlyFrom.rows.every((row) => row.effectiveTo === null || row.effectiveTo > '2026-01-01'),
    ).toBe(true);
  });
});

describe('검색·페이지·정렬', () => {
  it('품명 또는 품번 부분 일치(대소문자 무시), 와일드카드는 문자 그대로', async () => {
    const byCode = await getPriceRows(handle.db, filter({ q: 'p2002030005' }));
    expect(byCode.total).toBeGreaterThan(0);
    expect(byCode.rows.every((row) => row.itemCode === 'P2002030005')).toBe(true);
    expect((await getPriceRows(handle.db, filter({ q: '%' }))).total).toBe(0);
  });

  it('50행 페이지, 범위 밖 페이지는 마지막으로, effective_from DESC 정렬', async () => {
    const first = await getPriceRows(handle.db, filter({}));
    expect(first).toMatchObject({ total: 200, pageCount: Math.ceil(200 / PRICE_PAGE_SIZE) });
    expect(first.rows).toHaveLength(PRICE_PAGE_SIZE);
    const dates = first.rows.map((row) => row.effectiveFrom);
    expect(dates).toEqual([...dates].sort().reverse());
    const beyond = await getPriceRows(handle.db, filter({ page: '99' }));
    expect(beyond.page).toBe(first.pageCount);
  });

  it('행 상세: 원본 20컬럼 + 같은 계열 이력(최신순), 없는 id 는 null', async () => {
    const [row] = (await getPriceRows(handle.db, filter({ q: 'P2002030005' }))).rows;
    const detail = await getPriceRowDetail(handle.db, row!.id);
    expect(detail?.row).toMatchObject({
      itemCode: 'P2002030005',
      source: 'erp',
      batchFileName: 'sales-200.xlsx',
    });
    expect(detail?.history.length).toBeGreaterThanOrEqual(1);
    expect(detail?.history.some((entry) => entry.id === row!.id)).toBe(true);
    expect(await getPriceRowDetail(handle.db, 999_999)).toBeNull();
  });
});

describe('품목 마스터 적용 후 (AC-11 연쇄·AC-14/22 품목상태)', () => {
  beforeAll(async () => {
    await applyPolicy(ctx(), { salesBatchId, itemBatchId, salesReused: true, itemReused: false });
  });

  it('품목상태 라벨: 임시/폐기/사용/미확인(마스터 없음·매핑 불가)', async () => {
    const all = await getPriceRows(handle.db, { ...filter({}), page: 1 });
    const statuses = new Set<string>();
    for (let page = 1; page <= all.pageCount; page += 1) {
      for (const row of (await getPriceRows(handle.db, { ...filter({}), page })).rows)
        statuses.add(row.itemStatus);
    }
    expect([...statuses].sort()).toEqual(['미확인', '사용', '임시', '폐기'].sort());
  });

  it('대분류 선택 → 해당 중분류, 중분류 선택 → 해당 소분류, 필터 결과도 좁혀진다', async () => {
    const options = await getCategoryOptions(handle.db, {});
    expect(options.hasMaster).toBe(true);
    const major = options.majors[0]!;
    const withMajor = await getCategoryOptions(handle.db, { major });
    expect(withMajor.mids.length).toBeGreaterThan(0);
    expect(withMajor.minors).toEqual([]);
    const mid = withMajor.mids[0]!;
    const withMid = await getCategoryOptions(handle.db, { major, mid });
    expect(withMid.minors.length).toBeGreaterThan(0);

    const page = await getPriceRows(handle.db, filter({ major, mid }));
    expect(page.total).toBeGreaterThan(0);
    expect(page.rows.every((row) => row.major === major && row.mid === mid)).toBe(true);
    const minor = withMid.minors[0]!;
    const narrowed = await getPriceRows(handle.db, filter({ major, mid, minor }));
    expect(narrowed.rows.every((row) => row.minor === minor)).toBe(true);
  });
});
