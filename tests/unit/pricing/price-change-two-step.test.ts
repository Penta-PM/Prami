// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db, DbHandle } from '@/db';
import * as schema from '@/db/schema';
import { importBatches, items, salesPrices } from '@/db/schema';
import { PRICE_TYPE_NONE, priceFilterDefs } from '@/features/pricing/column-filters';
import { parsePriceFilter, PRICE_SORT_IDS } from '@/features/pricing/filter';
import {
  getPriceRows,
  getPriceRowsFullWindow,
  PRICE_PAGE_SIZE,
  type PricePage,
} from '@/server/pricing/queries';

import { createTestDb } from '../../helpers/pglite';

/**
 * 가격 변동 2단계 (#55 성능, Plan §8 C/A): 가격 변동으로 정렬·필터하지 않으면 현재 페이지 계열만 직전가 윈도를 돈다.
 * 기준(oracle) = 전체 윈도 구현(getPriceRowsFullWindow, 2단계 이전 getPriceRows 와 같은 쿼리) —
 * 행·순서·직전가·변동률·건수·페이지가 모든 페이지에서 같아야 한다.
 */
let handle: DbHandle;
/** 같은 PGlite 클라이언트에 SQL 로거를 단 핸들 — 경로(전체 윈도 / 2단계) 확인용 */
let logged: Db;
const queries: string[] = [];

type Seed = {
  code: string;
  from: string;
  price: string;
  priceType?: string | null;
  currency?: 'KRW' | 'USD' | 'JPY';
  customer?: string;
  status?: '운영중' | '미사용';
  deleted?: boolean;
  remark?: string | null;
  to?: string | null;
};

const CURRENCIES = ['KRW', 'USD', 'JPY'] as const;

/**
 * 30개 품번 × 계열 변형(단가유형 NULL·화폐·거래처). 적용시작일이 2016~2025 에 흩어져 기본 정렬(적용시작일 DESC)에서
 * 한 계열의 행들이 여러 페이지에 나뉜다. 계열 중간 삭제 행, 직전가 0, 같은 날짜·같은 품명(tie-breaker) 포함.
 */
function buildSeeds(): Seed[] {
  const out: Seed[] = [];
  for (let s = 0; s < 30; s += 1) {
    const code = `P${String(s).padStart(2, '0')}`;
    const variant = {
      priceType: s % 7 === 3 ? null : s % 5 === 1 ? '할인' : '정상판매',
      currency: CURRENCIES[s % 3],
      customer: s % 4 === 2 ? 'C01' : s % 9 === 5 ? 'C02' : '0',
    };
    const length = 1 + (s % 8);
    for (let k = 0; k < length; k += 1) {
      const year = 2016 + ((s + k * 3) % 10);
      const month = 1 + ((s * 5 + k) % 12);
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      // 같은 계열의 적용시작일이 겹치지 않게 k 로 일(day)을 다르게
      const day = String(1 + k).padStart(2, '0');
      const price =
        s % 6 === 0 && k === 0 ? '0.00' : (1000 + ((s * 37 + k * 113) % 900) * 10).toFixed(2);
      out.push({
        code,
        from: `${from.slice(0, 8)}${day}`,
        price,
        ...variant,
        status: (s + k) % 5 === 0 ? '미사용' : '운영중',
        deleted: k > 0 && (s + k) % 6 === 0,
        remark: k % 3 === 0 ? null : `remark ${s}-${k}`,
        to: k % 2 === 0 ? null : '2026-01-01',
      });
    }
    // 같은 품번·다른 계열(거래처) — 계열 경계: 서로의 직전가가 되지 않는다
    if (s % 3 === 0) {
      out.push({ code, from: '2020-06-01', price: '77.00', ...variant, customer: 'C99' });
      out.push({ code, from: '2022-06-01', price: '88.00', ...variant, customer: 'C99' });
    }
  }
  // 같은 적용시작일·품명 다수 — id tie-breaker 로 페이지가 갈린다
  for (let i = 0; i < PRICE_PAGE_SIZE; i += 1)
    out.push({ code: 'TIE', from: '2021-03-01', price: `${100 + i}.00`, customer: `T${i}` });
  return out;
}

const SEEDS = buildSeeds();
const seedById = new Map<number, Seed>();

const seriesOf = (seed: Seed) =>
  [
    seed.code,
    seed.priceType === undefined ? '정상판매' : (seed.priceType ?? ''),
    seed.currency ?? 'KRW',
    seed.customer ?? '0',
  ].join('|');

/** JS 로 구한 직전가: 같은 계열·삭제 제외·적용시작일이 바로 앞인 행의 판매가 */
function expectedPrevious(seed: Seed): Seed | undefined {
  return SEEDS.filter(
    (other) => !other.deleted && seriesOf(other) === seriesOf(seed) && other.from < seed.from,
  ).sort((a, b) => (a.from < b.from ? 1 : -1))[0];
}

beforeAll(async () => {
  handle = await createTestDb();
  // createTestDb 의 unit 핸들은 drizzle-orm/pglite — 같은 PGlite 클라이언트(같은 데이터)를 로거와 함께 다시 감싼다
  const { $client } = handle.db as unknown as { $client: PGlite };
  logged = drizzle({
    client: $client,
    schema,
    logger: { logQuery: (query) => void queries.push(query) },
  }) as unknown as Db;
  const [batch] = await handle.db
    .insert(importBatches)
    .values({ kind: 'sales_price', fileName: 'x.xlsx', fileSha256: 'x'.repeat(64), fileSize: 1 })
    .returning();
  // 일부 품번만 품목 마스터(대분류·중분류·상태) — 나머지는 미확인
  await handle.db.insert(items).values(
    Array.from({ length: 30 }, (_, s) => s)
      .filter((s) => s % 3 !== 1)
      .map((s) => ({
        itemCode: `P${String(s).padStart(2, '0')}`,
        itemName: `item-P${s}`,
        categoryMajor: s % 2 === 0 ? 'WAPPLES' : 'D.AMO',
        categoryMid: s % 4 === 0 ? 'HW' : 'SW',
        itemStatus: (['사용', '임시', '폐기'] as const)[s % 3],
        itemKind: '본품' as const,
        importBatchId: batch!.id,
      })),
  );
  const inserted = await handle.db
    .insert(salesPrices)
    .values(
      SEEDS.map((seed, i) => ({
        sourceId: 1000 + i,
        productFamily: 'WAPPLES',
        itemCode: seed.code,
        // 품명 일부 중복 — 품명 정렬 tie
        itemName: `item-${seed.code.slice(0, 2)}`,
        unit: 'EA',
        priceType: seed.priceType === undefined ? '정상판매' : seed.priceType,
        priceCategory: '일반',
        currency: seed.currency ?? 'KRW',
        hasCorePrice: false,
        unitPrice: seed.price,
        remark: seed.remark ?? null,
        effectiveFrom: seed.from,
        effectiveTo: seed.to ?? null,
        operationStatus: seed.status ?? ('운영중' as const),
        appliesToAllCustomers: false,
        isFinalSource: true,
        baseCoreCount: 0,
        unitPricePerCore: '0.00',
        customerCode: seed.customer ?? '0',
        source: 'erp' as const,
        deletedAt: seed.deleted ? new Date() : null,
      })),
    )
    .returning({ id: salesPrices.id });
  inserted.forEach((row, i) => seedById.set(row.id, SEEDS[i]!));
});

afterAll(async () => {
  await handle.close();
});

const DEFS = priceFilterDefs(['JPY', 'KRW', 'USD'], ['할인', '정상판매', PRICE_TYPE_NONE], {
  withPriceChange: true,
});
const parse = (params: Record<string, string>, n: number) =>
  parsePriceFilter({ ...params, page: String(n) }, DEFS, PRICE_SORT_IDS).filter;

/** 모든 페이지(+ 범위 밖 페이지 = 마지막으로 접힘)를 두 구현으로 받아 비교 */
async function expectSameAsOracle(params: Record<string, string>, db: Db = handle.db) {
  const first = await getPriceRowsFullWindow(handle.db, parse(params, 1));
  const pages: PricePage[] = [];
  for (let n = 1; n <= first.pageCount + 1; n += 1) {
    const filter = parse(params, n);
    const expected = await getPriceRowsFullWindow(handle.db, filter);
    const actual = await getPriceRows(db, filter, { withPriceChange: true });
    expect(actual).toEqual(expected);
    pages.push(actual);
  }
  return { first, pages };
}

const SORTS = PRICE_SORT_IDS.filter((id) => id !== 'priceChange');

const FILTERS: Record<string, Record<string, string>> = {
  '화폐 USD': { 'f.currency.in': 'USD' },
  '화폐 KRW,JPY + 판매가 범위': {
    'f.currency.in': 'KRW,JPY',
    'f.price.gte': '3000',
    'f.price.lte': '8000',
  },
  '단가유형 없음(NULL)': { 'f.priceType.in': PRICE_TYPE_NONE },
  '단가유형 할인': { 'f.priceType.in': '할인' },
  '품목상태 사용·미확인': { 'f.itemStatus.in': '사용,미확인' },
  '상태 미사용': { 'f.status.in': '미사용' },
  '비고 포함': { 'f.remark.has': 'remark 1' },
  검색: { q: 'P0' },
  '대분류 + 중분류': { major: 'WAPPLES', mid: 'HW' },
  '적용시작일 범위': { from: '2019-01-01', to: '2023-12-31' },
  '적용기간 기준': { dateMode: 'period', from: '2024-01-01', to: '2024-12-31' },
  '결과 0건': { q: 'no-such-item' },
};

describe('가격 변동 2단계 — 전체 윈도 구현과 같은 결과', () => {
  it('시드: 4페이지 이상, 삭제·직전가 0·단가유형 NULL·여러 화폐·거래처', async () => {
    const { first, pages } = await expectSameAsOracle({});
    expect(first.pageCount).toBeGreaterThanOrEqual(4);
    expect(first.total).toBe(SEEDS.filter((seed) => !seed.deleted).length);
    const all = pages.slice(0, first.pageCount).flatMap((p) => p.rows);
    expect(new Set(all.map((row) => row.id)).size).toBe(first.total);
    // 시나리오가 실제로 들어 있는지
    expect(all.some((row) => row.priceType === null && row.previousPrice !== null)).toBe(true);
    expect(all.some((row) => row.previousPrice === '0.00' && row.priceChangeRate === null)).toBe(
      true,
    );
    expect(new Set(all.map((row) => row.currency))).toEqual(new Set(CURRENCIES));
    // 계열의 직전 행이 다른 페이지에 있는 행이 있다 (기본 정렬)
    const pageOf = new Map(all.map((row, i) => [row.id, Math.floor(i / PRICE_PAGE_SIZE)]));
    const idOf = new Map([...seedById].map(([id, seed]) => [seed, id]));
    const crossPage = all.filter((row) => {
      const prev = expectedPrevious(seedById.get(row.id)!);
      return prev !== undefined && pageOf.get(idOf.get(prev)!) !== pageOf.get(row.id);
    });
    expect(crossPage.length).toBeGreaterThan(10);
  });

  it('기본 진입 (정렬·필터 없음) — 모든 페이지', async () => {
    await expectSameAsOracle({});
  });

  it.each(SORTS.flatMap((id) => [[id, 'asc'] as const, [id, 'desc'] as const]))(
    '다른 열 정렬 %s %s — 모든 페이지',
    async (sort, dir) => {
      await expectSameAsOracle({ sort, dir });
    },
  );

  it.each(Object.entries(FILTERS))('필터 %s — 모든 페이지 (+ 품명 정렬)', async (_, params) => {
    await expectSameAsOracle(params);
    await expectSameAsOracle({ ...params, sort: 'itemName', dir: 'desc' });
  });

  it('직전가 = JS 로 구한 같은 계열·삭제 제외 직전 행 (삭제 행·다른 거래처 계열은 건너뜀)', async () => {
    const { first, pages } = await expectSameAsOracle({});
    const all = pages.slice(0, first.pageCount).flatMap((p) => p.rows);
    let skippedDeleted = 0;
    for (const row of all) {
      const seed = seedById.get(row.id)!;
      const prev = expectedPrevious(seed);
      expect(row.previousPrice).toBe(prev?.price ?? null);
      const withDeleted = SEEDS.filter(
        (other) => seriesOf(other) === seriesOf(seed) && other.from < seed.from,
      ).sort((x, y) => (x.from < y.from ? 1 : -1))[0];
      if (withDeleted?.deleted) skippedDeleted += 1;
    }
    expect(skippedDeleted).toBeGreaterThan(0);
  });
});

describe('가격 변동 2단계 — 경로', () => {
  const lagQueries = () => queries.filter((q) => q.includes('lag('));

  it('정렬·필터가 가격 변동이 아니면: count 에 윈도 없음, 윈도는 페이지 계열(in 목록)로만', async () => {
    queries.length = 0;
    await getPriceRows(logged, parse({ 'f.currency.in': 'USD', sort: 'price', dir: 'desc' }, 1), {
      withPriceChange: true,
    });
    expect(queries).toHaveLength(3); // count, 페이지, 계열 윈도
    expect(queries[0]).toMatch(/count\(/);
    expect(queries[0]).not.toContain('lag(');
    expect(queries[1]).not.toContain('lag(');
    expect(lagQueries()).toHaveLength(1);
    expect(lagQueries()[0]).toMatch(/"series_key" in \(/);
  });

  it('결과 0건이면 윈도 쿼리를 하지 않는다', async () => {
    queries.length = 0;
    const result = await getPriceRows(logged, parse({ q: 'no-such-item' }, 1), {
      withPriceChange: true,
    });
    expect(result.rows).toEqual([]);
    expect(lagQueries()).toHaveLength(0);
  });

  it('가격 변동 정렬: 전체 윈도(현행) — 결과 같음', async () => {
    for (const dir of ['asc', 'desc']) await expectSameAsOracle({ sort: 'priceChange', dir });
    queries.length = 0;
    await getPriceRows(logged, parse({ sort: 'priceChange', dir: 'desc' }, 2), {
      withPriceChange: true,
    });
    expect(lagQueries()).toHaveLength(1);
    expect(lagQueries()[0]).not.toMatch(/"series_key" in \(/);
    expect(queries[0]).not.toContain('lag('); // 필터 없음 → count 는 윈도 없이 (현행과 같다)
  });

  it('가격 변동 필터: count·페이지 모두 전체 윈도(현행) — 결과 같음', async () => {
    const params = { 'f.priceChange.gte': '0', 'f.priceChange.lte': '50' };
    const { first } = await expectSameAsOracle(params);
    expect(first.total).toBeGreaterThan(0);
    await expectSameAsOracle({ ...params, sort: 'effectiveFrom', dir: 'asc' });
    queries.length = 0;
    await getPriceRows(logged, parse(params, 1), { withPriceChange: true });
    expect(lagQueries()).toHaveLength(2);
    for (const q of lagQueries()) expect(q).not.toMatch(/"series_key" in \(/);
  });

  it('조회 화면(withPriceChange 없음): 윈도 쿼리 없음, 가격 변동 키 없음', async () => {
    queries.length = 0;
    const result = await getPriceRows(logged, parse({}, 1));
    expect(lagQueries()).toHaveLength(0);
    expect(result.rows.length).toBe(PRICE_PAGE_SIZE);
    expect(Object.hasOwn(result.rows[0]!, 'previousPrice')).toBe(false);
    expect(Object.hasOwn(result.rows[0]!, 'seriesKey')).toBe(false);
  });

  it('2단계 행 키 = 전체 윈도 행 키 (series_key 없음)', async () => {
    const [two, full] = await Promise.all([
      getPriceRows(handle.db, parse({}, 1), { withPriceChange: true }),
      getPriceRowsFullWindow(handle.db, parse({}, 1)),
    ]);
    expect(Object.keys(two.rows[0]!).sort()).toEqual(Object.keys(full.rows[0]!).sort());
  });
});
