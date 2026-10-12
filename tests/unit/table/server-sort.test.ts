// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, importBatches, items, materialCosts, salesPrices } from '@/db/schema';
import { AUDIT_SORT_IDS, type AuditSortId } from '@/features/audit/sort';
import { COST_SORT_IDS, type CostSortId } from '@/features/costs/sort';
import { parsePriceFilter, PRICE_SORT_IDS, type PriceSortId } from '@/features/pricing/filter';
import { AUDIT_RESULT_LABELS, formatAuditTarget } from '@/lib/audit-format';
import { previousDay } from '@/lib/pricing/period';
import {
  sortRows,
  STATUS_ORDERS,
  type SortDir,
  type SortType,
  type SortValue,
} from '@/lib/table/compare';
import {
  getAuditLogs,
  getAuditLogsForExport,
  parseAuditFilter,
  type AuditPage,
} from '@/server/audit/queries';
import { costAccessForTests } from '@/server/cost/access-token';
import { parseCostFilter } from '@/server/cost/filter';
import { getCostRows, type CostRow } from '@/server/cost/queries';
import { queryRows } from '@/server/imports/sql-rows';
import { getPriceRows, PRICE_PAGE_SIZE, type PriceRow } from '@/server/pricing/queries';
import { byText } from '@/server/pricing/sort-sql';

import { createTestDb } from '../../helpers/pglite';
import { PARITY_STRINGS } from '../../helpers/sort-strings';

/**
 * #32 PR-3 서버 정렬 (스펙 §2·§3·§7): 화이트리스트, 페이지 연속성, NULLS LAST, stable tie-breaker,
 * 클라이언트 비교 함수(sortRows)와 서버 ORDER BY 의 결과 일치, 상태 CASE 순서, 감사 CSV 행 순서.
 *
 * 기준: "기본 정렬로 받은 전체 행" 에 클라이언트 sortRows 를 적용한 결과 == 서버 정렬로 받은 전 페이지 이어 붙인 결과.
 * (같은 값은 원래 순서 유지 = 서버의 기본 정렬 tie-breaker 와 같다)
 */
let handle: DbHandle;
const access = costAccessForTests({ id: null, email: 'vitest-sort' });
const N = PARITY_STRINGS.length * 3; // 3페이지 이상 (50행 페이지)
const pick = (i: number): string | null => PARITY_STRINGS[i % PARITY_STRINGS.length] ?? null;
const DIRS: readonly SortDir[] = ['asc', 'desc'];
const IPS = ['10.0.0.2', '9.1.1.1', '192.168.0.10', '::1', '2001:db8::1', null] as const;
const RESULTS = ['success', 'denied', 'error'] as const;

type Key<T> = { get: (row: T) => SortValue; type: SortType; order?: readonly string[] };
/** 한 열 정렬의 클라이언트 기대값: keys 앞이 1차 키. 뒤 키부터 stable 정렬을 반복 = 사전식(각 키 NULLS LAST) */
type ClientSpec<T> = Key<T>[];

function clientSort<T>(rows: readonly T[], spec: ClientSpec<T>, dir: SortDir): T[] {
  return [...spec]
    .reverse()
    .reduce<T[]>((acc, key) => sortRows(acc, key.get, key.type, dir, key.order), rows.slice());
}

async function allPages<T>(
  fetchPage: (page: number) => Promise<{ rows: T[]; pageCount: number }>,
): Promise<T[][]> {
  const first = await fetchPage(1);
  const pages = [first.rows];
  for (let page = 2; page <= first.pageCount; page += 1) pages.push((await fetchPage(page)).rows);
  return pages;
}

const text = <T>(get: (row: T) => string | null): Key<T> => ({ get, type: 'text' });
const yearOf = (iso: string) => Number(iso.slice(0, 4));

beforeAll(async () => {
  handle = await createTestDb();
  const [batch] = await handle.db
    .insert(importBatches)
    .values({ kind: 'item_master', fileName: 'sort.xlsx', fileSha256: 'sort-test', fileSize: 1 })
    .returning({ id: importBatches.id });

  const priceRows = Array.from({ length: N }, (_, i) => {
    const year = 2020 + (i % 6);
    return {
      sourceId: 5000 + i,
      productFamily: ['WAPPLES', 'D.AMO', 'iSIGN'][i % 3]!,
      itemCode: `S${String(i).padStart(3, '0')}`,
      itemName: pick(i) ?? 'null-name',
      unit: 'EA',
      priceType: pick(i * 7 + 1),
      priceCategory: '일반',
      currency: ['KRW', 'USD', 'JPY'][(i * 2) % 3]!,
      hasCorePrice: false,
      unitPrice: `${((i * 37) % 10) * 1000}.00`,
      remark: pick(i * 11 + 3),
      effectiveFrom: `${year}-0${1 + (i % 9)}-15`,
      effectiveTo: i % 3 === 0 ? null : `${year + (i % 2)}-0${1 + ((i * 2) % 9)}-01`,
      operationStatus: i % 2 === 0 ? ('운영중' as const) : ('미사용' as const),
      appliesToAllCustomers: false,
      isFinalSource: true,
      baseCoreCount: 0,
      unitPricePerCore: '0.00',
      customerCode: '0',
      source: 'erp' as const,
    };
  });
  await handle.db.insert(salesPrices).values(priceRows);
  // 품목 마스터: 4건 중 3건만 (나머지는 미확인)
  await handle.db.insert(items).values(
    priceRows
      .filter((_, i) => i % 4 !== 0)
      .map((row, j) => ({
        itemCode: row.itemCode,
        itemName: row.itemName,
        categoryMajor: pick(j * 5 + 2) ?? 'WAPPLES',
        categoryMid: pick(j * 13 + 4),
        categoryMinor: pick(j * 17 + 6),
        itemStatus: (['사용', '임시', '폐기'] as const)[j % 3],
        itemKind: '본품' as const,
        importBatchId: batch!.id,
      })),
  );

  await handle.db.insert(materialCosts).values(
    Array.from({ length: N }, (_, i) => {
      const year = 2020 + (i % 5);
      return {
        materialCode: pick(i * 3 + 5) ?? '',
        materialName: pick(i) ?? '',
        unit: pick(i * 7 + 2) ?? '',
        priceType: `pt${i}`,
        priceCategory: '일반',
        currency: ['KRW', 'USD', 'JPY'][i % 3]!,
        unitCost: `${((i * 31) % 7) * 100}.00`,
        effectiveFrom: `${year}-0${1 + (i % 8)}-10`,
        effectiveTo: i % 4 === 0 ? null : `${year + 1}-0${1 + (i % 7)}-01`,
        operationStatus: i % 3 === 0 ? ('운영중' as const) : ('미사용' as const),
        isFinalSource: false,
        appliesToAllCustomers: false,
        source: 'erp' as const,
        productFamily: 'WAPPLES',
      };
    }),
  );

  await handle.db.insert(auditLogs).values(
    Array.from({ length: N }, (_, i) => ({
      actorLabel: pick(i) ?? '',
      action: pick(i * 5 + 1) ?? 'none',
      targetType: i % 4 === 0 ? null : pick(i * 3 + 2),
      targetLabel: i % 5 === 0 ? null : pick(i * 7 + 3),
      targetId: i % 2 === 0 ? `t-${i}` : null,
      ip: IPS[i % IPS.length],
      result: RESULTS[(i * 2) % 3]!,
      // 같은 시각이 섞이도록 (tie-breaker 확인)
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, Math.floor(i / 2))),
    })),
  );
});

afterAll(async () => {
  await handle.close();
});

// ───────────────────────── 가격 ─────────────────────────

const priceFilter = (params: Record<string, string>) => parsePriceFilter(params).filter;
const pricePages = (params: Record<string, string>) =>
  allPages((page) => getPriceRows(handle.db, priceFilter({ ...params, page: String(page) })));

const PRICE_CLIENT: Record<PriceSortId, ClientSpec<PriceRow>> = {
  priceType: [text((row) => row.priceType)],
  major: [text((row) => row.major)],
  mid: [text((row) => row.mid)],
  minor: [text((row) => row.minor)],
  itemName: [text((row) => row.itemName)],
  price: [
    { get: (row) => ({ amount: Number(row.unitPrice), currency: row.currency }), type: 'number' },
  ],
  effectiveFrom: [{ get: (row) => row.effectiveFrom, type: 'date' }],
  period: [
    { get: (row) => row.effectiveFrom, type: 'date' },
    { get: (row) => row.effectiveTo, type: 'date' },
  ],
  operationYears: [
    { get: (row) => yearOf(row.effectiveFrom), type: 'number' },
    {
      get: (row) => (row.effectiveTo ? yearOf(previousDay(row.effectiveTo)) : null),
      type: 'number',
    },
  ],
  itemStatus: [{ get: (row) => row.itemStatus, type: 'status', order: STATUS_ORDERS.partMapping }],
  status: [
    { get: (row) => row.operationStatus, type: 'status', order: STATUS_ORDERS.pricingState },
  ],
  remark: [text((row) => row.remark)],
};

describe('가격 표 서버 정렬', () => {
  let defaults: PriceRow[];

  beforeAll(async () => {
    const pages = await pricePages({});
    expect(pages.length).toBeGreaterThanOrEqual(3);
    defaults = pages.flat();
    expect(defaults).toHaveLength(N);
  });

  it('화이트리스트 밖(sort=id;drop 등)은 무시하고 기본 정렬로 응답한다', async () => {
    for (const sort of ['id;drop', 'id; drop table sales_prices;--', 'actions', '__proto__']) {
      expect((await pricePages({ sort, dir: 'asc' })).flat().map((row) => row.id)).toEqual(
        defaults.map((row) => row.id),
      );
    }
  });

  it('기본 정렬 = effective_from DESC, item_name, id (정렬 없을 때 기존과 같다)', () => {
    for (let i = 1; i < defaults.length; i += 1) {
      const [a, b] = [defaults[i - 1]!, defaults[i]!];
      expect(a.effectiveFrom >= b.effectiveFrom).toBe(true);
    }
  });

  for (const id of PRICE_SORT_IDS) {
    for (const dir of DIRS) {
      it(`${id} ${dir}: 전 페이지 이어 붙인 순서 == 클라이언트 sortRows (NULLS LAST·stable 포함)`, async () => {
        const pages = await pricePages({ sort: id, dir });
        const expected = clientSort(defaults, PRICE_CLIENT[id], dir).map((row) => row.id);
        expect(pages.flat().map((row) => row.id)).toEqual(expected);
        expect(pages[0]).toHaveLength(PRICE_PAGE_SIZE);
      });
    }
  }

  it('판매가 오름차순: 1페이지 첫 행이 전체 최소, 다음 페이지 첫 행 ≥ 이전 페이지 마지막 (같은 통화 안)', async () => {
    const pages = await pricePages({ sort: 'price', dir: 'asc', page: '2' });
    const all = pages.flat();
    const min = [...all].sort(
      (a, b) =>
        (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0) ||
        Number(a.unitPrice) - Number(b.unitPrice),
    )[0]!;
    expect(pages[0]![0]).toMatchObject({ currency: min.currency, unitPrice: min.unitPrice });
    for (let p = 1; p < pages.length; p += 1) {
      const last = pages[p - 1]!.at(-1)!;
      const head = pages[p]![0]!;
      expect(
        head.currency > last.currency ||
          (head.currency === last.currency && Number(head.unitPrice) >= Number(last.unitPrice)),
      ).toBe(true);
    }
  });

  it('텍스트 빈 값(null·""·"—"·공백만)은 방향과 관계없이 맨 뒤', async () => {
    const isEmpty = (value: string | null) => value === null || ['', '—'].includes(value.trim());
    for (const dir of DIRS) {
      const rows = (await pricePages({ sort: 'priceType', dir })).flat();
      const firstEmpty = rows.findIndex((row) => isEmpty(row.priceType));
      expect(firstEmpty).toBeGreaterThan(0);
      expect(rows.slice(firstEmpty).every((row) => isEmpty(row.priceType))).toBe(true);
    }
  });

  it('품목상태 CASE 순서: 사용 → 임시 → 폐기 → 미확인 (desc 는 역순)', async () => {
    const order = (rows: PriceRow[]) => [...new Set(rows.map((row) => row.itemStatus))];
    expect(order((await pricePages({ sort: 'itemStatus', dir: 'asc' })).flat())).toEqual([
      '사용',
      '임시',
      '폐기',
      '미확인',
    ]);
    expect(order((await pricePages({ sort: 'itemStatus', dir: 'desc' })).flat())).toEqual([
      '미확인',
      '폐기',
      '임시',
      '사용',
    ]);
    const status = (await pricePages({ sort: 'status', dir: 'asc' })).flat();
    expect([...new Set(status.map((row) => row.operationStatus))]).toEqual(['운영중', '미사용']);
  });

  it('같은 정렬을 반복해도 순서가 같다 (tie-breaker 끝은 id)', async () => {
    const a = (await pricePages({ sort: 'status', dir: 'desc' })).flat().map((row) => row.id);
    const b = (await pricePages({ sort: 'status', dir: 'desc' })).flat().map((row) => row.id);
    expect(a).toEqual(b);
  });
});

// ─────────────────── 클라이언트/서버 문자열 비교 일치 ───────────────────

describe('클라이언트 compareText == 서버 lower(x COLLATE "C") COLLATE "C" (대표 문자열 세트)', () => {
  for (const dir of DIRS) {
    it(`${dir}`, async () => {
      // 입력 순서(ord)가 원래 순서 — 같은 값(대소문자만 다름)은 ord 로 stable
      const values = sql.join(
        PARITY_STRINGS.map((value, ord) => sql`(${ord}::int, ${value}::text)`),
        sql`, `,
      );
      const v = sql`v.s`;
      const rows = await queryRows<{ ord: number; s: string | null }>(
        handle.db,
        sql`select v.ord, v.s from (values ${values}) as v(ord, s)
            order by ${sql.join([...byText(v, dir), sql`v.ord asc`], sql`, `)}`,
      );
      const expected = sortRows(
        PARITY_STRINGS.map((s, ord) => ({ ord, s })),
        (row) => row.s,
        'text',
        dir,
      );
      expect(rows.map((row) => row.ord)).toEqual(expected.map((row) => row.ord));
      // 사용자 수용 사항: 'WAPPLES-2700' 이 'WAPPLES-300' 보다 앞
      if (dir === 'asc') {
        const order = rows.map((row) => row.s);
        expect(order.indexOf('WAPPLES-2700')).toBeLessThan(order.indexOf('WAPPLES-300'));
      }
    });
  }
});

// ───────────────────────── 원가 ─────────────────────────

const costPages = (params: Record<string, string>) =>
  allPages((page) =>
    getCostRows(access, handle.db, parseCostFilter({ ...params, page: String(page) }).filter),
  );

const COST_CLIENT: Record<CostSortId, ClientSpec<CostRow>> = {
  code: [text((row) => row.materialCode)],
  name: [text((row) => row.materialName)],
  unit: [text((row) => row.unit)],
  cost: [
    { get: (row) => ({ amount: Number(row.unitCost), currency: row.currency }), type: 'number' },
  ],
  effectiveFrom: [{ get: (row) => row.effectiveFrom, type: 'date' }],
  period: [
    { get: (row) => row.effectiveFrom, type: 'date' },
    { get: (row) => row.effectiveTo, type: 'date' },
  ],
  status: [
    { get: (row) => row.operationStatus, type: 'status', order: STATUS_ORDERS.pricingState },
  ],
};

describe('원가 표 서버 정렬', () => {
  let defaults: CostRow[];

  beforeAll(async () => {
    defaults = (await costPages({})).flat();
    expect(defaults).toHaveLength(N);
  });

  it('화이트리스트 밖(sort=id;drop, 옛 category)은 기본 정렬', async () => {
    for (const sort of ['id;drop', 'category']) {
      expect((await costPages({ sort })).flat().map((row) => row.id)).toEqual(
        defaults.map((row) => row.id),
      );
    }
  });

  for (const id of COST_SORT_IDS) {
    for (const dir of DIRS) {
      it(`${id} ${dir}: 전 페이지 순서 == 클라이언트 sortRows`, async () => {
        const rows = (await costPages({ sort: id, dir })).flat();
        expect(rows.map((row) => row.id)).toEqual(
          clientSort(defaults, COST_CLIENT[id], dir).map((row) => row.id),
        );
      });
    }
  }
});

// ───────────────────────── 감사 로그 ─────────────────────────

type AuditRow = AuditPage['rows'][number];
const auditPages = (params: Record<string, string>) =>
  allPages((page) => getAuditLogs(handle.db, parseAuditFilter({ ...params, page: String(page) })));

const AUDIT_CLIENT: Record<AuditSortId, ClientSpec<AuditRow>> = {
  createdAt: [{ get: (row) => row.createdAt, type: 'date' }],
  actor: [text((row) => row.actorLabel)],
  action: [text((row) => row.action)],
  target: [text((row) => formatAuditTarget(row))],
  ip: [text((row) => row.ip)],
  result: [
    {
      get: (row) => AUDIT_RESULT_LABELS[row.result],
      type: 'status',
      order: STATUS_ORDERS.auditResult,
    },
  ],
};

describe('감사 로그 서버 정렬 + CSV', () => {
  let defaults: AuditRow[];

  beforeAll(async () => {
    defaults = (await auditPages({})).flat();
    expect(defaults).toHaveLength(N);
  });

  it('화이트리스트 밖(sort=id;drop, before)은 기본 정렬(최신순)', async () => {
    for (const sort of ['id;drop', 'before']) {
      expect((await auditPages({ sort })).flat().map((row) => row.id)).toEqual(
        defaults.map((row) => row.id),
      );
      const exported = await getAuditLogsForExport(handle.db, parseAuditFilter({ sort }));
      expect(exported.map((row) => row.id)).toEqual(defaults.map((row) => row.id));
    }
  });

  for (const id of AUDIT_SORT_IDS) {
    for (const dir of DIRS) {
      it(`${id} ${dir}: 화면 전 페이지 == CSV 행 순서 == 클라이언트 sortRows`, async () => {
        const expected = clientSort(defaults, AUDIT_CLIENT[id], dir).map((row) => row.id);
        const screen = (await auditPages({ sort: id, dir })).flat();
        expect(screen.map((row) => row.id)).toEqual(expected);
        const exported = await getAuditLogsForExport(
          handle.db,
          parseAuditFilter({ sort: id, dir, page: '2' }),
        );
        expect(exported.map((row) => row.id)).toEqual(expected);
      });
    }
  }

  it('결과 CASE 순서: 성공 → 거부 → 오류', async () => {
    const rows = (await auditPages({ sort: 'result', dir: 'asc' })).flat();
    expect([...new Set(rows.map((row) => row.result))]).toEqual(['success', 'denied', 'error']);
  });
});
