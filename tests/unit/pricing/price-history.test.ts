// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { importBatches, items, salesPrices } from '@/db/schema';
import { parsePriceFilter } from '@/features/pricing/filter';
import { changeAmountLabel, priceChangeDisplay } from '@/lib/pricing/format';
import {
  getPriceHistory,
  getPriceRows,
  type PriceHistory,
  type PriceRow,
} from '@/server/pricing/queries';

import { createTestDb } from '../../helpers/pglite';

/**
 * 가격 변동 이력 (price-change-history-modal §2.1·§3): 행 id → 같은 계열(삭제 제외) 전부, 최신 순,
 * 표(getPriceRows, #55)와 **같은 변동률식**(공용 상수) — 같은 데이터로 두 쿼리의 값을 맞춰 본다.
 */
let handle: DbHandle;
const ids = new Map<string, number>();

type Seed = {
  key: string;
  code: string;
  from: string;
  price: string;
  to?: string | null;
  priceType?: string | null;
  currency?: string;
  customer?: string;
  customerName?: string | null;
  deleted?: boolean;
  manual?: boolean;
  status?: '운영중' | '미사용';
  remark?: string;
};

const SEEDS: Seed[] = [
  // A: 첫 시기 → +10% → 변동 없음 → (삭제) → −10% (삭제 행은 건너뛴다)
  {
    key: 'A1',
    code: 'A',
    from: '2020-01-01',
    price: '1000.00',
    to: '2021-01-01',
    remark: '20.01 최초',
  },
  {
    key: 'A2',
    code: 'A',
    from: '2021-01-01',
    price: '1100.00',
    to: '2022-01-01',
    remark: '21.01 인상',
  },
  { key: 'A3', code: 'A', from: '2022-01-01', price: '1100.00', to: '2024-01-01' },
  { key: 'A4', code: 'A', from: '2023-01-01', price: '5000.00', deleted: true },
  { key: 'A5', code: 'A', from: '2024-01-01', price: '990.00', manual: true },
  // A 와 품번만 같은 다른 계열(단가유형·화폐·거래처) — 이력에 섞이지 않는다
  { key: 'AT', code: 'A', from: '2021-06-01', price: '1.00', priceType: '할인' },
  { key: 'AU', code: 'A', from: '2021-06-01', price: '3.00', currency: 'USD' },
  {
    key: 'AC',
    code: 'A',
    from: '2021-06-01',
    price: '4.00',
    customer: 'C01',
    customerName: '고객사',
  },
  // R: 반올림(±0.05% → ±0.1, −0.04997% → 0.0), 통화 USD
  { key: 'R1', code: 'R', from: '2020-01-01', price: '2000.00', currency: 'USD' },
  { key: 'R2', code: 'R', from: '2021-01-01', price: '2001.00', currency: 'USD' },
  { key: 'R3', code: 'R', from: '2022-01-01', price: '2000.00', currency: 'USD' },
  { key: 'R4', code: 'R', from: '2023-01-01', price: '1000.00', currency: 'USD' },
  // B: 직전가 0 → 변동률 null, 금액은 +700
  { key: 'B1', code: 'B', from: '2020-01-01', price: '0.00' },
  { key: 'B2', code: 'B', from: '2021-01-01', price: '700.00' },
  // S: 1행 계열
  { key: 'S1', code: 'S', from: '2022-01-01', price: '50.00', status: '미사용' },
  // D: 유일한 행이 삭제됨
  { key: 'D1', code: 'D', from: '2022-01-01', price: '50.00', deleted: true },
];

beforeAll(async () => {
  handle = await createTestDb();
  const [batch] = await handle.db
    .insert(importBatches)
    .values({
      kind: 'sales_price',
      fileName: 'sales-2026.xlsx',
      fileSha256: 'x'.repeat(64),
      fileSize: 1,
    })
    .returning();
  await handle.db.insert(items).values({
    itemCode: 'A',
    itemName: 'item-A',
    raw: { 비고: '담당 홍길동' },
    importBatchId: batch!.id,
  });
  const inserted = await handle.db
    .insert(salesPrices)
    .values(
      SEEDS.map((seed, i) => ({
        sourceId: 100 + i,
        productFamily: 'WAPPLES',
        itemCode: seed.code,
        itemName: `item-${seed.code}`,
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
        customerName: seed.customerName ?? null,
        source: seed.manual ? ('manual' as const) : ('erp' as const),
        importBatchId: seed.manual ? null : batch!.id,
        deletedAt: seed.deleted ? new Date() : null,
      })),
    )
    .returning({ id: salesPrices.id });
  SEEDS.forEach((seed, i) => ids.set(seed.key, inserted[i]!.id));
});

afterAll(async () => {
  await handle.close();
});

const id = (key: string) => ids.get(key)!;
const history = async (key: string, includeRemark = false) =>
  (await getPriceHistory(handle.db, id(key), { includeRemark }))!;

async function allTableRows(): Promise<PriceRow[]> {
  const first = await getPriceRows(handle.db, parsePriceFilter({}).filter);
  const out = [...first.rows];
  for (let n = 2; n <= first.pageCount; n += 1)
    out.push(...(await getPriceRows(handle.db, parsePriceFilter({ page: String(n) }).filter)).rows);
  return out;
}

describe('getPriceHistory — 계열·정렬·삭제 제외', () => {
  it('클릭한 행의 계열만, 삭제 행 제외, 적용시작일 최신 순', async () => {
    const result = await history('A2');
    expect(result.currentId).toBe(id('A2'));
    expect(result.rows.map((row) => row.id)).toEqual([id('A5'), id('A3'), id('A2'), id('A1')]);
    expect(result.rows.some((row) => row.id === id('A4'))).toBe(false);
    // 계열 안 어느 행으로 열어도 같은 목록
    expect((await history('A5')).rows.map((row) => row.id)).toEqual(
      result.rows.map((row) => row.id),
    );
  });

  it('계열 요약: 품명·품번·단가유형·단가구분·화폐·거래처 코드/명', async () => {
    expect((await history('A1')).series).toEqual({
      itemName: 'item-A',
      itemCode: 'A',
      priceType: '정상판매',
      priceCategory: '일반',
      currency: 'KRW',
      customerCode: '0',
      customerName: null,
    });
    expect((await history('AC')).series).toMatchObject({
      customerCode: 'C01',
      customerName: '고객사',
    });
    expect((await history('AC')).rows.map((row) => row.id)).toEqual([id('AC')]);
  });

  it('삭제된 행·없는 id → null (NOT_FOUND)', async () => {
    expect(await getPriceHistory(handle.db, id('A4'))).toBeNull();
    expect(await getPriceHistory(handle.db, id('D1'))).toBeNull();
    expect(await getPriceHistory(handle.db, 999_999)).toBeNull();
  });

  it('1행 계열', async () => {
    const result = await history('S1');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      previousPrice: null,
      changeAmount: null,
      changeRate: null,
      operationStatus: '미사용',
    });
  });
});

describe('getPriceHistory — 직전가·금액·변동률 (#55 와 같은 식)', () => {
  let table: PriceRow[];
  let all: PriceHistory['rows'];
  beforeAll(async () => {
    table = await allTableRows();
    all = [];
    for (const key of ['A1', 'AT', 'AU', 'AC', 'R1', 'B1', 'S1'])
      all.push(...(await history(key)).rows);
  });

  it('같은 데이터로 getPriceRows 와 직전가·변동률이 모든 행에서 같다 (표기 포함)', () => {
    expect(all).toHaveLength(table.length);
    for (const row of all) {
      const base = table.find((r) => r.id === row.id)!;
      expect(base).toBeDefined();
      expect([row.previousPrice, row.changeRate]).toEqual([
        base.previousPrice,
        base.priceChangeRate,
      ]);
      expect(priceChangeDisplay(row.unitPrice, row.previousPrice, row.changeRate)).toEqual(
        priceChangeDisplay(base.unitPrice, base.previousPrice, base.priceChangeRate),
      );
    }
  });

  it('직전 대비 금액은 SQL 의 numeric 문자열 — 부호 그대로, 가장 오래된 행 null', async () => {
    const byId = new Map(all.map((row) => [row.id, row]));
    expect(byId.get(id('A1'))).toMatchObject({ changeAmount: null, changeRate: null });
    expect(byId.get(id('A2'))).toMatchObject({ changeAmount: '100.00', changeRate: 10 });
    expect(byId.get(id('A3'))).toMatchObject({ changeAmount: '0.00', changeRate: 0 });
    // 삭제된 A4 를 건너뛰어 A3 기준
    expect(byId.get(id('A5'))).toMatchObject({
      previousPrice: '1100.00',
      changeAmount: '-110.00',
      changeRate: -10,
    });
    expect(byId.get(id('R2'))).toMatchObject({ changeAmount: '1.00', changeRate: 0.1 });
    expect(byId.get(id('R3'))).toMatchObject({ changeAmount: '-1.00', changeRate: 0 });
    expect(byId.get(id('B2'))).toMatchObject({
      previousPrice: '0.00',
      changeAmount: '700.00',
      changeRate: null,
    });
  });

  it('금액 표기: 부호 + 통화, 첫 행 —', () => {
    expect(changeAmountLabel('100.00', 'KRW')).toBe('+100원');
    expect(changeAmountLabel('-110.00', 'KRW')).toBe('-110원');
    expect(changeAmountLabel('0.00', 'KRW')).toBe('0원');
    expect(changeAmountLabel('-1.00', 'USD')).toBe('-1 USD');
    expect(changeAmountLabel('1234567.50', 'JPY')).toBe('+1,234,567.5 JPY');
    expect(changeAmountLabel(null, 'KRW')).toBe('—');
  });
});

describe('getPriceHistory — 응답 키 (원가·ERP 비고·변경자)', () => {
  it('출처: ERP 행은 배치 파일명, 수동 행은 null', async () => {
    const byId = new Map((await history('A1')).rows.map((row) => [row.id, row]));
    expect(byId.get(id('A1'))).toMatchObject({ source: 'erp', batchFileName: 'sales-2026.xlsx' });
    expect(byId.get(id('A5'))).toMatchObject({ source: 'manual', batchFileName: null });
  });

  it('행별 비고(sales_prices.remark)는 역할과 관계없이 모든 행에, 가격 표 비고와 같은 값', async () => {
    const table = await allTableRows();
    for (const includeRemark of [false, true]) {
      const rows = (await history('A1', includeRemark)).rows;
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(id('A1'))!.remark).toBe('20.01 최초');
      expect(byId.get(id('A2'))!.remark).toBe('21.01 인상');
      expect(byId.get(id('A5'))!.remark).toBeNull();
      for (const row of rows) {
        expect(Object.hasOwn(row, 'remark')).toBe(true);
        expect(row.remark).toBe(table.find((r) => r.id === row.id)!.remark);
        // 품목 마스터 비고는 행에 싣지 않는다
        expect(Object.hasOwn(row, 'erpRemark')).toBe(false);
      }
    }
  });

  it('품목 마스터 비고(erpRemark)는 includeRemark(ADMIN) 일 때만 요약에 한 번, 아니면 키 자체가 없다', async () => {
    expect(Object.hasOwn((await history('A1')).series, 'erpRemark')).toBe(false);
    expect((await history('A1', true)).series.erpRemark).toBe('담당 홍길동');
    // 품목 마스터가 없는 품목 → null (키는 있음)
    expect((await history('R1', true)).series).toMatchObject({ erpRemark: null });
    const user = JSON.stringify(await history('A1'));
    expect(user).not.toContain('erpRemark');
    expect(user).not.toContain('담당 홍길동');
  });

  it('키 목록 스냅샷 — 원가·변경자·series_key 없음', async () => {
    const result = await history('A1');
    expect(Object.keys(result).sort()).toEqual(['currentId', 'rows', 'series']);
    expect(Object.keys(result.rows[0]!).sort()).toEqual(
      [
        'batchFileName',
        'changeAmount',
        'changeRate',
        'effectiveFrom',
        'effectiveTo',
        'id',
        'operationStatus',
        'previousPrice',
        'remark',
        'source',
        'unitPrice',
      ].sort(),
    );
    expect(Object.keys(result.series).sort()).toEqual(
      [
        'currency',
        'customerCode',
        'customerName',
        'itemCode',
        'itemName',
        'priceCategory',
        'priceType',
      ].sort(),
    );
    const json = JSON.stringify(await history('A1', true));
    expect(json).not.toMatch(/cost|created|updated|seriesKey|series_key/i);
  });

  it('입력은 id 만 — 이력 쿼리·액션·모달은 원가 모듈을 import 하지 않는다', () => {
    const files = [
      'src/server/pricing/queries.ts',
      'src/server/pricing/price-change-sql.ts',
      'src/features/pricing/actions.ts',
      'src/features/pricing/PriceHistoryModal.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/server\/cost|material-costs|cost-item-links|features\/costs/);
    }
    // 시그니처: (db, 가격 행 id, 옵션) — 계열 키를 받는 인자가 없다
    expect(getPriceHistory.length).toBe(2);
  });
});
