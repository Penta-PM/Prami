// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { salesPrices } from '@/db/schema';
import { layoutColumnsFor } from '@/features/pricing/columns';
import { priceFilterDefs } from '@/features/pricing/column-filters';
import { parsePriceFilter, PRICE_SORT_IDS, PRICE_VIEW_SORT_IDS } from '@/features/pricing/filter';
import { priceChangeDisplay } from '@/lib/pricing/format';
import { normalizeLayout } from '@/lib/table/layout-storage';
import { getPriceRows, PRICE_PAGE_SIZE, type PriceRow } from '@/server/pricing/queries';

import { createTestDb } from '../../helpers/pglite';

/**
 * 가격 변동 열 (cost-ratio-price-change §2.4): 같은 계열(품번|단가유형|단가구분|화폐|거래처코드) 직전 적용시작일 행 대비.
 * 필터·페이지 적용 전 전체(삭제 제외) 기준 lag, 첫 시기·직전가 0 은 null, 소수 1자리 반올림(절댓값 half-up).
 */
let handle: DbHandle;

type Seed = {
  code: string;
  from: string;
  price: string;
  priceType?: string | null;
  category?: string;
  currency?: string;
  customer?: string;
  family?: string;
  deleted?: boolean;
};

const SEEDS: Seed[] = [
  // A: 기본 계열 — 첫 시기 null, +10%, 변동 없음, 삭제 행 건너뜀
  { code: 'A', from: '2020-01-01', price: '1000.00' },
  { code: 'A', from: '2021-01-01', price: '1100.00' },
  { code: 'A', from: '2022-01-01', price: '1100.00' },
  { code: 'A', from: '2023-01-01', price: '5000.00', deleted: true },
  { code: 'A', from: '2024-01-01', price: '990.00' },
  // A 와 품번만 같고 계열 요소가 다른 행들 — 각자 첫 시기(null)
  { code: 'A', from: '2021-06-01', price: '1.00', priceType: '할인' },
  { code: 'A', from: '2021-06-01', price: '2.00', category: '특별' },
  { code: 'A', from: '2021-06-01', price: '3.00', currency: 'USD' },
  { code: 'A', from: '2021-06-01', price: '4.00', customer: 'C01' },
  { code: 'A', from: '2021-06-01', price: '5.00', priceType: null },
  // B: 직전가 0 → null, 그다음은 0 이 아닌 직전가 기준
  { code: 'B', from: '2020-01-01', price: '0.00' },
  { code: 'B', from: '2021-01-01', price: '700.00' },
  { code: 'B', from: '2022-01-01', price: '770.00' },
  // R·H: 반올림 — 0.05% → 0.1, −0.05% → −0.1, −0.04997% → 0.0(가격은 다름)
  { code: 'R', from: '2020-01-01', price: '2000.00' },
  { code: 'R', from: '2021-01-01', price: '2001.00' }, // +0.05% (정확히 반) → 0.1
  { code: 'R', from: '2022-01-01', price: '2000.00' }, // −0.04997…% → −0.0 → 0.0
  { code: 'R', from: '2023-01-01', price: '1000.00' },
  { code: 'R', from: '2024-01-01', price: '1000.50' }, // +0.05% → 0.1
  { code: 'R', from: '2025-01-01', price: '1000.00' }, // −0.04997…% → 0.0
  { code: 'H', from: '2020-01-01', price: '1000.00' },
  { code: 'H', from: '2021-01-01', price: '999.50' }, // −0.05% → −0.1
  { code: 'H', from: '2022-01-01', price: '1000.75' }, // +0.12506…% → 0.1
  // F: 다른 제품군(필터로 제외할 직전 행). 같은 계열이지만 직전 행 제품군이 다르다
  { code: 'F', from: '2020-01-01', price: '100.00', family: 'D.AMO' },
  { code: 'F', from: '2021-01-01', price: '150.00', family: 'WAPPLES' },
  // 채움: 기본 정렬(적용시작일 DESC)에서 A 2024(1페이지)와 그 직전 A 2022(2페이지)를 다른 페이지로 가른다
  ...Array.from({ length: PRICE_PAGE_SIZE }, (_, i) => ({
    code: `Z${String(i).padStart(2, '0')}`,
    from: '2023-06-01',
    price: '10.00',
  })),
];

beforeAll(async () => {
  handle = await createTestDb();
  await handle.db.insert(salesPrices).values(
    SEEDS.map((seed, i) => ({
      sourceId: 100 + i,
      productFamily: seed.family ?? 'WAPPLES',
      itemCode: seed.code,
      itemName: `item-${seed.code}`,
      unit: 'EA',
      priceType: seed.priceType === undefined ? '정상판매' : seed.priceType,
      priceCategory: seed.category ?? '일반',
      currency: seed.currency ?? 'KRW',
      hasCorePrice: false,
      unitPrice: seed.price,
      remark: `remark-${i}`,
      effectiveFrom: seed.from,
      effectiveTo: null,
      operationStatus: '운영중' as const,
      appliesToAllCustomers: false,
      isFinalSource: true,
      baseCoreCount: 0,
      unitPricePerCore: '0.00',
      customerCode: seed.customer ?? '0',
      source: 'erp' as const,
      deletedAt: seed.deleted ? new Date() : null,
    })),
  );
});

afterAll(async () => {
  await handle.close();
});

/** 관리 화면 + pricing.write (가격 변동 노출) — 서버 판정 값 그대로 */
const page = (params: Record<string, string>, n: number) =>
  getPriceRows(
    handle.db,
    parsePriceFilter(
      { ...params, page: String(n) },
      priceFilterDefs(['KRW', 'USD'], [], { withPriceChange: true }),
      PRICE_SORT_IDS,
    ).filter,
    { withPriceChange: true },
  );

/** 전 페이지 이어 붙인 행 */
async function rows(params: Record<string, string> = {}): Promise<PriceRow[]> {
  const first = await page(params, 1);
  const out = [...first.rows];
  for (let n = 2; n <= first.pageCount; n += 1) out.push(...(await page(params, n)).rows);
  return out;
}

/** 기본 필터 전 행에서 (품번·적용시작일·가격) → 행 */
function find(all: PriceRow[], code: string, from: string, price?: string): PriceRow {
  const row = all.find(
    (r) => r.itemCode === code && r.effectiveFrom === from && (!price || r.unitPrice === price),
  );
  if (!row) throw new Error(`no row ${code} ${from} ${price ?? ''}`);
  return row;
}

describe('getPriceRows 가격 변동 (직전가·변동률)', () => {
  let all: PriceRow[];
  beforeAll(async () => {
    all = await rows();
    expect(all).toHaveLength(SEEDS.length - 1); // 삭제 1행 제외
  });

  it('같은 계열 직전 행 기준, 첫 시기 null, 변동 없음은 0', () => {
    expect(find(all, 'A', '2020-01-01')).toMatchObject({
      previousPrice: null,
      priceChangeRate: null,
    });
    expect(find(all, 'A', '2021-01-01')).toMatchObject({
      previousPrice: '1000.00',
      priceChangeRate: 10,
    });
    expect(find(all, 'A', '2022-01-01')).toMatchObject({
      previousPrice: '1100.00',
      priceChangeRate: 0,
    });
  });

  it('삭제 행은 건너뛴다 (2024 의 직전 = 2022, 삭제된 2023 아님)', () => {
    expect(find(all, 'A', '2024-01-01')).toMatchObject({
      previousPrice: '1100.00',
      priceChangeRate: -10,
    });
  });

  it('계열 요소(단가유형·단가구분·화폐·거래처코드, 단가유형 NULL)가 다르면 다른 계열', () => {
    for (const price of ['1.00', '2.00', '3.00', '4.00', '5.00'])
      expect(find(all, 'A', '2021-06-01', price)).toMatchObject({
        previousPrice: null,
        priceChangeRate: null,
      });
  });

  it('직전가 0 → null, 그다음은 정상 계산', () => {
    expect(find(all, 'B', '2021-01-01')).toMatchObject({
      previousPrice: '0.00',
      priceChangeRate: null,
    });
    expect(find(all, 'B', '2022-01-01').priceChangeRate).toBe(10);
  });

  it('소수 1자리 반올림: ±0.05% → ±0.1 (절댓값 half-up), −0.04997% → 0.0', () => {
    expect(find(all, 'R', '2021-01-01').priceChangeRate).toBe(0.1);
    expect(find(all, 'R', '2022-01-01').priceChangeRate).toBe(0);
    expect(Object.is(find(all, 'R', '2022-01-01').priceChangeRate, -0)).toBe(false);
    expect(find(all, 'R', '2023-01-01').priceChangeRate).toBe(-50);
    expect(find(all, 'R', '2024-01-01').priceChangeRate).toBe(0.1);
    expect(find(all, 'R', '2025-01-01').priceChangeRate).toBe(0);
    expect(find(all, 'H', '2021-01-01').priceChangeRate).toBe(-0.1);
    expect(find(all, 'H', '2022-01-01').priceChangeRate).toBe(0.1);
  });

  it('직전 행이 필터 밖이어도 같은 값 (제품군·검색·날짜 필터)', async () => {
    const [byFamily] = await rows({ major: 'WAPPLES', q: 'item-F' });
    expect(byFamily).toMatchObject({ itemCode: 'F', previousPrice: '100.00', priceChangeRate: 50 });
    const byYear = await rows({ from: '2024-01-01', to: '2024-12-31', q: 'item-A' });
    expect(byYear).toHaveLength(1);
    expect(byYear[0]).toMatchObject({ previousPrice: '1100.00', priceChangeRate: -10 });
  });

  it('직전 행이 다른 페이지여도 같은 값', async () => {
    const [first, second] = [await page({}, 1), await page({}, 2)];
    const a2024 = first.rows.find((r) => r.itemCode === 'A' && r.effectiveFrom === '2024-01-01');
    expect(second.rows.some((r) => r.itemCode === 'A' && r.effectiveFrom === '2022-01-01')).toBe(
      true,
    );
    expect(a2024).toMatchObject({ previousPrice: '1100.00', priceChangeRate: -10 });
    // 정렬을 바꿔 페이지 배치가 달라져도 행마다 같은 값
    for (const row of await rows({ sort: 'effectiveFrom', dir: 'asc' })) {
      const base = all.find((r) => r.id === row.id)!;
      expect([row.previousPrice, row.priceChangeRate]).toEqual([
        base.previousPrice,
        base.priceChangeRate,
      ]);
    }
  });

  it('정렬 priceChange: 오름·내림 숫자순, null 은 방향과 관계없이 맨 뒤', async () => {
    for (const dir of ['asc', 'desc'] as const) {
      const rates = (await rows({ sort: 'priceChange', dir })).map((row) => row.priceChangeRate);
      const firstNull = rates.indexOf(null);
      expect(rates.slice(firstNull).every((rate) => rate === null)).toBe(true);
      const filled = rates.slice(0, firstNull) as number[];
      expect(filled).toEqual([...filled].sort((a, b) => (dir === 'asc' ? a - b : b - a)));
      expect(filled[0]).toBe(dir === 'asc' ? -50 : 50);
    }
  });

  it('비고 열 값은 그대로 (ERP 원문)', () => {
    expect(find(all, 'A', '2020-01-01').remark).toBe('remark-0');
  });
});

describe('priceChangeDisplay (표시 4상태)', () => {
  it('직전 없음·직전가 0 → —', () => {
    expect(priceChangeDisplay('1000.00', null, null)).toEqual({ kind: 'none' });
    expect(priceChangeDisplay('1000.00', '0.00', null)).toEqual({ kind: 'none' });
  });

  it('같은 가격 → 변동 없음', () => {
    expect(priceChangeDisplay('1100.00', '1100.00', 0)).toEqual({
      kind: 'same',
      text: '변동 없음',
    });
  });

  it('상승·하락 (절댓값, 소수 1자리)', () => {
    expect(priceChangeDisplay('1100.00', '1000.00', 10)).toEqual({
      kind: 'up',
      arrow: '▲',
      text: '이전 대비 10.0% 상승',
    });
    expect(priceChangeDisplay('990.00', '1100.00', -10)).toEqual({
      kind: 'down',
      arrow: '▼',
      text: '이전 대비 10.0% 하락',
    });
    expect(priceChangeDisplay('999.50', '1000.00', -0.1)).toMatchObject({
      text: '이전 대비 0.1% 하락',
    });
  });

  it('가격은 다른데 반올림이 0.0 이면 방향은 유지하고 0.0%', () => {
    expect(priceChangeDisplay('2001.00', '2000.00', 0)).toMatchObject({
      kind: 'up',
      text: '이전 대비 0.0% 상승',
    });
    expect(priceChangeDisplay('2000.00', '2001.00', 0)).toMatchObject({
      kind: 'down',
      text: '이전 대비 0.0% 하락',
    });
  });
});

describe('저장된 열 레이아웃 정규화 (#32 §5) — 가격 변동 열 추가', () => {
  it('조회 표: 가격 변동이 저장된 레이아웃(#55 시기) → priceChange id 는 버리고 기존 순서·너비 유지 (pricing-view-hide-price-change §2)', () => {
    const columns = layoutColumnsFor('view');
    expect(columns.map((column) => column.id)).not.toContain('priceChange');
    const saved = {
      order: [
        'itemName',
        'price',
        'priceType',
        'major',
        'mid',
        'minor',
        'period',
        'priceChange',
        'remark',
        'status',
        'itemStatus',
      ],
      widths: { itemName: 240, priceChange: 160, remark: 180 },
    };
    expect(normalizeLayout(saved, columns)).toEqual({
      order: [
        'itemName',
        'price',
        'priceType',
        'major',
        'mid',
        'minor',
        'period',
        'remark',
        'status',
        'itemStatus',
      ],
      widths: { itemName: 240, remark: 180 },
    });
  });

  it('관리 표: 운영 연도 뒤에 끼우고 관리 열은 끝에 고정', () => {
    const columns = layoutColumnsFor('admin', false, true);
    const saved = {
      order: [
        'remark',
        'priceType',
        'major',
        'mid',
        'minor',
        'itemName',
        'price',
        'effectiveFrom',
        'period',
        'operationYears',
        'itemStatus',
        'status',
        'actions',
      ],
      widths: { price: 150 },
    };
    const layout = normalizeLayout(saved, columns)!;
    expect(layout.order).toEqual([
      'remark',
      'priceType',
      'major',
      'mid',
      'minor',
      'itemName',
      'price',
      'effectiveFrom',
      'period',
      'operationYears',
      'priceChange',
      'itemStatus',
      'status',
      'actions',
    ]);
    expect(layout.widths).toEqual({ price: 150 });
  });
});

/**
 * 조회 화면(/pricing) 가격 변동 비노출 (pricing-view-hide-price-change §2): withPriceChange 없음(기본) =
 * 직전가 윈도 조인 없음, 행에 previousPrice·priceChangeRate 키 0, `f.priceChange.*`·`sort=priceChange` 는 무시.
 */
describe('getPriceRows 조회 모드 — 가격 변동 키 없음', () => {
  const viewPage = (params: Record<string, string>, n = 1) =>
    getPriceRows(
      handle.db,
      parsePriceFilter(
        { ...params, page: String(n) },
        priceFilterDefs(['KRW', 'USD']),
        PRICE_VIEW_SORT_IDS,
      ).filter,
    );

  it('조회 모드 결과 행에 priceChange·previousPrice 키가 없다 (JSON 직렬화 기준), 관리 모드는 있다', async () => {
    const view = await viewPage({});
    expect(view.rows.length).toBeGreaterThan(0);
    for (const row of view.rows) {
      expect(Object.keys(row)).not.toContain('previousPrice');
      expect(Object.keys(row)).not.toContain('priceChangeRate');
    }
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/previousPrice|priceChange/);
    const admin = await page({}, 1);
    expect(Object.keys(admin.rows[0]!)).toEqual(
      expect.arrayContaining(['previousPrice', 'priceChangeRate']),
    );
  });

  it('URL `f.priceChange.gte=1&sort=priceChange&dir=desc` → 오류 없이 무시, 기본 정렬·전체 건수', async () => {
    const params = { 'f.priceChange.gte': '1', sort: 'priceChange', dir: 'desc' };
    const parsed = parsePriceFilter(params, priceFilterDefs(['KRW', 'USD']), PRICE_VIEW_SORT_IDS);
    expect(parsed.filter.filters).toBeUndefined();
    expect(parsed.filter.sort).toBeUndefined();
    expect(parsed.errors).toEqual({});
    const ignored = await viewPage(params);
    const plain = await viewPage({});
    expect(ignored.total).toBe(plain.total);
    expect(ignored.rows.map((row) => row.id)).toEqual(plain.rows.map((row) => row.id));
  });

  it('파서를 거치지 않은 가격 변동 필터·정렬도 쿼리에서 무시한다 (2차 방어)', async () => {
    const plain = await viewPage({});
    const forced = await getPriceRows(handle.db, {
      ...parsePriceFilter({}).filter,
      filters: [{ col: 'priceChange', op: 'gte', value: '1' }],
      sort: { id: 'priceChange', dir: 'desc' },
    });
    expect(forced.total).toBe(plain.total);
    expect(forced.rows.map((row) => row.id)).toEqual(plain.rows.map((row) => row.id));
    expect(JSON.stringify(forced)).not.toMatch(/previousPrice|priceChange/);
  });
});
