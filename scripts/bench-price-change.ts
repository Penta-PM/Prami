/**
 * 가격 관리 표 가격 변동 성능 벤치 (#55 성능, Plan §8 C/A) — 수동 실행 전용(테스트 스위트·CI 에서 돌지 않는다).
 *
 *   BENCH_DATABASE_URL=postgres://…/prami_perf_bench pnpm exec tsx --conditions=react-server scripts/bench-price-change.ts
 *
 * - 일회용 DB 전용: DB 이름에 `bench` 가 없으면 거부한다(.env 를 읽지 않는다 — 실제 DB 에 닿지 않게).
 * - 마이그레이션 적용 → sales_prices·items·import_batches 를 비우고 합성 행(기본 53,000, BENCH_ROWS)을 넣고 ANALYZE.
 * - 시나리오마다 2단계(getPriceRows) 와 전체 윈도(getPriceRowsFullWindow = 이전 구현)의 p50/p95 와 결과 동일 여부를 출력한다.
 */
import type { Db } from '../src/db';

const ROWS = Number(process.env.BENCH_ROWS ?? 53_000);
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 40);
const WARMUP = 5;
/** 이전(전체 윈도)·이후·참고(조회 화면 = 가격 변동 없음, 같은 필터·정렬의 하한) — 번갈아 잰다 */
const ORDER = ['before', 'after', 'view'] as const;
const REVERSED = ['view', 'after', 'before'] as const;

function benchUrl(): string {
  const url = process.env.BENCH_DATABASE_URL;
  if (!url) throw new Error('BENCH_DATABASE_URL 이 필요합니다 (일회용 벤치 DB)');
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.includes('bench')) throw new Error(`벤치 DB 이름에 'bench' 가 없습니다: ${name}`);
  return url;
}

/** 결정적 의사난수 (mulberry32) */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAMILIES = ['WAPPLES', 'D.AMO', 'iSIGN', 'Cloudbric', 'WAPPLES SA'];
const PRICE_TYPES = ['정상판매', '정상판매', '정상판매', '할인', '유지보수', null];
const CATEGORIES = ['일반', '일반', '조달', '특별'];

async function seed(db: Db): Promise<void> {
  const { sql } = await import('drizzle-orm');
  const { importBatches, items, salesPrices } = await import('../src/db/schema');
  await db.execute(
    sql`truncate ${salesPrices}, ${items}, ${importBatches} restart identity cascade`,
  );
  const [batch] = await db
    .insert(importBatches)
    .values({
      kind: 'sales_price',
      fileName: 'bench.xlsx',
      fileSha256: 'b'.repeat(64),
      fileSize: 1,
    })
    .returning();
  const rand = random(55);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
  // 품번 ≈ 행 / 6, 품번마다 계열 1~3개(단가유형·단가구분·화폐·거래처), 계열마다 1~8 시기 (평균 ≈ 4.4 행/계열)
  const codes = Math.round(ROWS / 6);
  const itemRows = [];
  for (let c = 0; c < codes; c += 1) {
    if (c % 5 === 4) continue; // 일부는 품목 마스터 없음(미확인)
    itemRows.push({
      itemCode: `BX${String(c).padStart(6, '0')}`,
      itemName: `bench item ${c}`,
      categoryMajor: FAMILIES[c % FAMILIES.length]!,
      categoryMid: pick(['HW', 'SW', '서비스']),
      categoryMinor: pick(['A', 'B', null]),
      itemStatus: pick(['사용', '사용', '임시', '폐기'] as const),
      itemKind: '본품' as const,
      importBatchId: batch!.id,
    });
  }
  for (let i = 0; i < itemRows.length; i += 2_000)
    await db.insert(items).values(itemRows.slice(i, i + 2_000));

  const rows: (typeof salesPrices.$inferInsert)[] = [];
  for (let c = 0; c < codes && rows.length < ROWS; c += 1) {
    const code = `BX${String(c).padStart(6, '0')}`;
    const family = FAMILIES[c % FAMILIES.length]!;
    const seriesCount = 1 + Math.floor(rand() * 3);
    const seen = new Set<string>();
    for (let s = 0; s < seriesCount && rows.length < ROWS; s += 1) {
      const priceType = pick(PRICE_TYPES);
      const currency = rand() < 0.85 ? 'KRW' : pick(['USD', 'JPY', 'EUR']);
      const customerCode = rand() < 0.8 ? '0' : `C${Math.floor(rand() * 400)}`;
      const priceCategory = pick(CATEGORIES);
      // 계열·적용시작일은 삭제 제외 유니크 — 같은 품번에서 계열이 겹치면 건너뛴다
      const key = [priceType, priceCategory, currency, customerCode].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const periods = 1 + Math.floor(rand() * 8);
      let price = Math.round(rand() * 50_000) * 1_000;
      let year = 2008 + Math.floor(rand() * 8);
      for (let p = 0; p < periods && rows.length < ROWS; p += 1) {
        const month = 1 + Math.floor(rand() * 12);
        const from = `${year}-${String(month).padStart(2, '0')}-01`;
        const last = p === periods - 1;
        rows.push({
          sourceId: rows.length + 1,
          productFamily: family,
          itemCode: code,
          itemName: `bench item ${c}`,
          unit: 'EA',
          priceType,
          priceCategory,
          currency,
          hasCorePrice: false,
          unitPrice: (rand() < 0.02 ? 0 : price).toFixed(2),
          remark: rand() < 0.3 ? `비고 ${c}-${p}` : null,
          effectiveFrom: from,
          effectiveTo: last ? null : `${year + 1}-01-01`,
          operationStatus: rand() < 0.85 ? '운영중' : '미사용',
          appliesToAllCustomers: false,
          isFinalSource: true,
          baseCoreCount: 0,
          unitPricePerCore: '0.00',
          customerCode,
          source: 'erp',
          importBatchId: batch!.id,
          deletedAt: rand() < 0.03 ? new Date() : null,
        });
        price = Math.max(0, Math.round(price * (0.9 + rand() * 0.3)));
        year += 1 + Math.floor(rand() * 2);
      }
    }
  }
  for (let i = 0; i < rows.length; i += 1_000)
    await db.insert(salesPrices).values(rows.slice(i, i + 1_000));
  await db.execute(sql`analyze`);
  console.log(`seeded sales_prices=${rows.length} items=${itemRows.length}`);
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function main(): Promise<void> {
  const url = benchUrl();
  process.env.DB_DRIVER = 'pg';
  process.env.DATABASE_URL = url;
  const [{ createDb }, { migrateDb }, filterModule, columnFilters, queries] = await Promise.all([
    import('../src/db'),
    import('../src/db/migrate'),
    import('../src/features/pricing/filter'),
    import('../src/features/pricing/column-filters'),
    import('../src/server/pricing/queries'),
  ]);
  const handle = await createDb({ driver: 'pg', databaseUrl: url });
  try {
    await migrateDb(handle);
    if (process.env.BENCH_SKIP_SEED !== '1') await seed(handle.db);
    const defs = columnFilters.priceFilterDefs(['EUR', 'JPY', 'KRW', 'USD'], [], {
      withPriceChange: true,
    });
    const parse = (params: Record<string, string>) =>
      filterModule.parsePriceFilter(params, defs, filterModule.PRICE_SORT_IDS).filter;
    const scenarios: Record<string, Record<string, string>> = {
      '기본 진입 (1페이지)': {},
      '기본 진입 (20페이지)': { page: '20' },
      '품명 정렬 asc': { sort: 'itemName', dir: 'asc' },
      '판매가 정렬 desc': { sort: 'price', dir: 'desc' },
      '화폐 USD 필터': { 'f.currency.in': 'USD' },
      '상태 미사용 + 대분류': { 'f.status.in': '미사용', major: 'WAPPLES' },
      '검색 q=item 12': { q: 'item 12' },
      '가격 변동 정렬 desc': { sort: 'priceChange', dir: 'desc' },
      '가격 변동 필터 ≥ 5': { 'f.priceChange.gte': '5' },
    };
    console.log(
      '| 시나리오 | 경로 | 이전 p50 | 이전 p95 | 이후 p50 | 이후 p95 | 참고: 조회 화면 p50/p95 | 건수 | 결과 같음 |',
    );
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const [name, params] of Object.entries(scenarios)) {
      const filter = parse(params);
      const run = {
        before: () => queries.getPriceRowsFullWindow(handle.db, filter),
        after: () => queries.getPriceRows(handle.db, filter, { withPriceChange: true }),
        view: () => queries.getPriceRows(handle.db, filter),
      };
      const times: Record<keyof typeof run, number[]> = { before: [], after: [], view: [] };
      for (let i = 0; i < WARMUP; i += 1) {
        await run.before();
        await run.after();
        await run.view();
      }
      // 번갈아 재서 캐시·부하 차이를 고르게
      for (let i = 0; i < ITERATIONS; i += 1)
        for (const key of i % 2 === 0 ? ORDER : REVERSED) {
          const start = performance.now();
          await run[key]();
          times[key].push(performance.now() - start);
        }
      const [before, after] = [await run.before(), await run.after()];
      const same = JSON.stringify(before) === JSON.stringify(after);
      const path =
        params.sort === 'priceChange' || params['f.priceChange.gte'] ? '전체 윈도' : '2단계';
      const fmt = (values: number[], p: number) =>
        percentile(
          [...values].sort((a, b) => a - b),
          p,
        ).toFixed(1);
      console.log(
        `| ${name} | ${path} | ${fmt(times.before, 50)} | ${fmt(times.before, 95)} | ${fmt(times.after, 50)} | ${fmt(times.after, 95)} | ${fmt(times.view, 50)} / ${fmt(times.view, 95)} | ${after.total} | ${same ? '예' : '**아니오**'} |`,
      );
      if (!same) process.exitCode = 1;
    }
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
  console.error(
    '[bench-price-change] 실패:',
    error instanceof Error ? error.message.slice(0, 200) : error,
    cause,
  );
  process.exitCode = 1;
});
