// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, importBatches, items, materialCosts, salesPrices } from '@/db/schema';
import {
  auditConditions,
  auditFilterDefs,
  auditFilterFields,
  filterToQuery as auditQuery,
} from '@/features/audit/filter';
import { costFilterDefs, costFilterFields } from '@/features/costs/column-filters';
import {
  PRICE_TYPE_NONE,
  priceFilterDefs,
  priceFilterFields,
} from '@/features/pricing/column-filters';
import { parsePriceFilter } from '@/features/pricing/filter';
import { filterAccessorsOf, filterDefsOf } from '@/components/ui/data-table/filter-fields';
import {
  filterRows,
  FILTER_LIMITS,
  parseFilterParams,
  type FilterCondition,
} from '@/lib/table/filter';
import {
  AUDIT_FILTER_SQL,
  getAuditLogs,
  getAuditLogsForExport,
  listAuditActions,
  parseAuditFilter,
} from '@/server/audit/queries';
import { costAccessForTests } from '@/server/cost/access-token';
import { parseCostFilter } from '@/server/cost/filter';
import {
  COST_FILTER_SQL,
  getCostRows,
  listCostCurrencies,
  type CostRow,
} from '@/server/cost/queries';
import {
  getPriceRows,
  listPriceCurrencies,
  listPriceTypes,
  PRICE_FILTER_SQL,
  type PriceRow,
} from '@/server/pricing/queries';
import { buildFilterSpec, filterSqlConditions } from '@/server/table/filter-sql';

import { createTestDb } from '../../helpers/pglite';
import { PARITY_STRINGS } from '../../helpers/sort-strings';

/**
 * 표 열 필터 A-2 서버 (스펙 §2.3·§4): 같은 데이터에 대해 서버 SQL(FILTER_SPEC) 결과 == 클라이언트 술어(matchesFilters) 결과,
 * 화이트리스트·한도, SQL 에 사용자 값 보간 0, 감사 별칭(from·to·action·actor)·옛 `?action=X`·CSV 동일 필터.
 *
 * 기준: "필터 없이 기본 정렬로 받은 전체 행" 에 클라이언트 filterRows(표와 같은 접근자) == 서버 필터로 받은 전 페이지 이어 붙인 결과(순서 포함).
 */
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.db,
}));
// CSV 라우트: 권한 가드는 rbac 단위 테스트가 다룬다 — 여기서는 필터 전파만
vi.mock('@/server/auth/rbac', () => ({
  runRoute: (_guard: unknown, fn: (user: unknown) => Promise<Response>) => fn({ id: 'u1' }),
}));

let handle: DbHandle;
const access = costAccessForTests({ id: null, email: 'vitest-filter' });
const N = PARITY_STRINGS.length * 3;
const pick = (i: number): string | null => PARITY_STRINGS[i % PARITY_STRINGS.length] ?? null;
const CURRENCIES = ['KRW', 'USD', 'JPY'] as const;
const IPS = ['10.0.0.2', '9.1.1.1', '192.168.0.10', '::1', '2001:db8::1', null] as const;
const RESULTS = ['success', 'denied', 'error'] as const;
/** 가격 변동 계열 (1번 계열 3번째 행은 삭제 — 직전가 계산에서도 빠진다) */
const CHANGE_SERIES: readonly (readonly string[])[] = [
  ['1000.00', '1000.00', '1100.00', '0.00', '500.00'],
  ['2000.00', '2001.00', '9999.00', '1999.00', '2200.00'],
  ['100.00', '110.00', '99.00', '99.00', '108.90'],
];

async function allPages<T>(
  fetchPage: (page: number) => Promise<{ rows: T[]; pageCount: number; total: number }>,
): Promise<{ rows: T[]; total: number }> {
  const first = await fetchPage(1);
  const rows = [...first.rows];
  for (let page = 2; page <= first.pageCount; page += 1) rows.push(...(await fetchPage(page)).rows);
  return { rows, total: first.total };
}

const ids = (rows: readonly { id: number }[]) => rows.map((row) => row.id);

beforeAll(async () => {
  handle = await createTestDb();
  state.db = handle.db;
  const priceRows = Array.from({ length: N }, (_, i) => ({
    sourceId: 7000 + i,
    productFamily: ['WAPPLES', 'D.AMO', 'iSIGN'][i % 3]!,
    itemCode: `F${String(i).padStart(3, '0')}`,
    itemName: `item-${i}`,
    unit: 'EA',
    priceType: pick(i * 7 + 1),
    priceCategory: '일반',
    currency: CURRENCIES[(i * 2) % 3]!,
    hasCorePrice: false,
    unitPrice: `${((i * 37) % 10) * 1000}.00`,
    remark: pick(i * 11 + 3),
    effectiveFrom: `${2020 + (i % 6)}-0${1 + (i % 9)}-15`,
    effectiveTo: null,
    operationStatus: i % 2 === 0 ? ('운영중' as const) : ('미사용' as const),
    appliesToAllCustomers: false,
    isFinalSource: true,
    baseCoreCount: 0,
    unitPricePerCore: '0.00',
    customerCode: '0',
    source: 'erp' as const,
  }));
  await handle.db.insert(salesPrices).values(priceRows);
  const base = priceRows[0]!;
  await handle.db.insert(salesPrices).values(
    CHANGE_SERIES.flatMap((prices, s) =>
      prices.map((price, k) => ({
        ...base,
        sourceId: 9500 + s * 10 + k,
        itemCode: `CH${s}`,
        itemName: `change-${s}`,
        priceType: '정상판매',
        currency: s % 2 === 0 ? 'KRW' : 'USD',
        unitPrice: price,
        remark: null,
        effectiveFrom: `202${k}-03-01`,
        deletedAt: s === 1 && k === 2 ? new Date() : null,
      })),
    ),
  );
  const [batch] = await handle.db
    .insert(importBatches)
    .values({
      kind: 'item_master',
      fileName: 'filter.xlsx',
      fileSha256: 'filter-test',
      fileSize: 1,
    })
    .returning({ id: importBatches.id });
  // 품목 마스터 3/4 (나머지는 미확인)
  await handle.db.insert(items).values(
    priceRows
      .filter((_, i) => i % 4 !== 0)
      .map((row, j) => ({
        itemCode: row.itemCode,
        itemName: row.itemName,
        categoryMajor: 'WAPPLES',
        itemStatus: (['사용', '임시', '폐기'] as const)[j % 3],
        itemKind: '본품' as const,
        importBatchId: batch!.id,
      })),
  );

  await handle.db.insert(materialCosts).values(
    Array.from({ length: N }, (_, i) => ({
      materialCode: `M${i}`,
      materialName: `mat-${i}`,
      unit: pick(i * 7 + 2) ?? '',
      priceType: `pt${i}`,
      priceCategory: '일반',
      currency: CURRENCIES[i % 3]!,
      unitCost: `${((i * 31) % 7) * 100}.00`,
      effectiveFrom: `${2020 + (i % 5)}-0${1 + (i % 8)}-10`,
      effectiveTo: null,
      operationStatus: i % 3 === 0 ? ('운영중' as const) : ('미사용' as const),
      isFinalSource: false,
      appliesToAllCustomers: false,
      source: 'erp' as const,
      productFamily: i % 2 === 0 ? 'WAPPLES' : 'iSIGN',
    })),
  );

  await handle.db.insert(auditLogs).values(
    Array.from({ length: N }, (_, i) => ({
      actorLabel: pick(i) ?? '',
      action: ['auth.login', 'user.update', 'price_policy.create', 'audit.export'][i % 4]!,
      targetType: i % 4 === 0 ? null : pick(i * 3 + 2),
      targetLabel: i % 5 === 0 ? null : pick(i * 7 + 3),
      targetId: i % 2 === 0 ? `t-${i}` : null,
      ip: IPS[i % IPS.length],
      result: RESULTS[(i * 2) % 3]!,
      // 3시간 간격 — KST 날짜 경계(15:00Z)를 여러 번 넘는다
      createdAt: new Date(Date.UTC(2026, 8, 1, 0) + i * 3 * 3_600_000),
    })),
  );
});

afterAll(async () => {
  await handle.close();
});

// ───────────────────────── 가격 ─────────────────────────

describe('가격 표 서버 필터 — 클라이언트 술어와 일치', () => {
  let currencies: string[];
  let priceTypes: string[];
  let all: PriceRow[];
  const fetchPrices = (params: Record<string, string>) =>
    allPages((page) => {
      const { filter } = parsePriceFilter(
        { ...params, page: String(page) },
        priceFilterDefs(currencies, priceTypes),
      );
      return getPriceRows(handle.db, filter);
    });

  beforeAll(async () => {
    currencies = await listPriceCurrencies(handle.db);
    expect(currencies).toEqual(['JPY', 'KRW', 'USD']);
    priceTypes = await listPriceTypes(handle.db);
    all = (await fetchPrices({})).rows;
  });

  const CASES: Record<string, Record<string, string>> = {
    '상태 운영중 + 비고 "app" 포함': { 'f.status.in': '운영중', 'f.remark.has': 'app' },
    '단가 유형 apple·Apple(다중, 정확히 같은 값만) + 품목상태 사용·미확인': {
      'f.priceType.in': 'apple,Apple',
      'f.itemStatus.in': '사용,미확인',
    },
    '단가 유형 — (없음: NULL·빈 문자열·공백만·"—") + 상태 운영중': {
      'f.priceType.in': PRICE_TYPE_NONE,
      'f.status.in': '운영중',
    },
    '단가 유형 — (없음) + 정상판매 + 통화 USD': {
      'f.priceType.in': `${PRICE_TYPE_NONE},정상판매`,
      'f.currency.in': 'USD',
    },
    '통화 KRW + 판매가 3,000~7,000': {
      'f.currency.in': 'KRW',
      'f.price.gte': '3000',
      'f.price.lte': '7000',
    },
    '통화 2개(범위 비활성) + 판매가 ≥ 3000 + 상태 미사용': {
      'f.currency.in': 'KRW,USD',
      'f.price.gte': '3000',
      'f.status.in': '미사용',
    },
    '가격 변동 0~10% + 통화 KRW (직전가는 필터 전 전체 기준)': {
      'f.priceChange.gte': '0',
      'f.priceChange.lte': '10',
      'f.currency.in': 'KRW',
    },
    '가격 변동 ≤ -1 + 단가 유형 정상판매': {
      'f.priceChange.lte': '-1',
      'f.priceType.in': '정상판매',
    },
    '비고 "äp" 포함(비ASCII 는 대소문자 구분) + 상태 둘 다': {
      'f.remark.has': 'äp',
      'f.status.in': '운영중,미사용',
    },
    '비고 "—" 같음(빈 값은 어떤 조건에도 안 맞음) + 단가 유형 a b·ab': {
      'f.remark.eq': '—',
      'f.priceType.in': 'a b,ab',
    },
    '기존 검색 q + 열 필터': { q: 'item-1', 'f.remark.has': 'a', 'f.status.in': '운영중' },
  };

  for (const [name, params] of Object.entries(CASES)) {
    it(name, async () => {
      const fields = priceFilterFields(currencies, priceTypes);
      const conds = parseFilterParams(params, filterDefsOf(fields));
      expect(conds.length).toBeGreaterThanOrEqual(2);
      const server = await fetchPrices(params);
      const base = params.q ? (await fetchPrices({ q: params.q })).rows : all;
      const client = filterRows(base, conds, filterAccessorsOf(fields), filterDefsOf(fields));
      expect(ids(server.rows)).toEqual(ids(client));
      // count 도 같은 WHERE (가격 변동 필터는 count 에도 직전가 윈도를 조인)
      expect(server.total).toBe(client.length);
    });
  }

  it('데이터가 비어 있지 않은 결과를 내는 케이스가 있다 (일치 테스트가 공집합끼리 비교만 하지 않도록)', async () => {
    const nonEmpty = await Promise.all(
      Object.values(CASES).map(async (params) => (await fetchPrices(params)).total > 0),
    );
    expect(nonEmpty.filter(Boolean).length).toBeGreaterThanOrEqual(6);
  });

  it('가격 변동 필터는 직전가 계산에 영향이 없다 (변동률 값이 필터 전과 같다)', async () => {
    const filtered = (await fetchPrices({ 'f.priceChange.gte': '-100' })).rows;
    const byId = new Map(all.map((row) => [row.id, row.priceChangeRate]));
    expect(filtered.length).toBeGreaterThan(0);
    for (const row of filtered) expect(row.priceChangeRate).toBe(byId.get(row.id));
  });

  it('화이트리스트: 열·연산자·원가 비중·같은 의미 열·데이터에 없는 통화는 무시, 한도 초과 조건은 버린다', () => {
    const defs = priceFilterDefs(currencies, priceTypes);
    const parse = (params: Record<string, string>) => parsePriceFilter(params, defs).filter;
    expect(
      parse({
        'f.x;drop.has': '1',
        'f.price.like': '1',
        'f.costRatio.gte': '1',
        'f.major.has': 'W',
        'f.mid.has': 'W',
        'f.minor.has': 'W',
        'f.itemName.has': 'W',
        'f.effectiveFrom.gte': '2024-01-01',
        'f.period.gte': '2024-01-01',
        'f.operationYears.gte': '2024',
        'f.currency.in': 'EUR',
        'f.status.in': '운영중,bogus',
        'f.remark.has': 'x'.repeat(FILTER_LIMITS.valueMax + 1),
        'f.__proto__.has': '1',
      }).filters,
    ).toBeUndefined();
    expect(Object.keys(defs)).not.toEqual(
      expect.arrayContaining(['costRatio', 'major', 'itemName']),
    );
    // in 값 21개 → 그 조건만 버림
    const many = Array.from({ length: 21 }, () => '운영중').join(',');
    expect(parse({ 'f.status.in': many, 'f.remark.has': 'a' }).filters).toEqual([
      { col: 'remark', op: 'has', value: 'a' },
    ]);
  });

  it('단가 유형 선택지 = 데이터 distinct(코드포인트 순, 빈 값은 맨 뒤 하나), 목록 밖 URL 값·텍스트 연산자는 버린다 (§7 Q3 B)', () => {
    expect(priceTypes.at(-1)).toBe(PRICE_TYPE_NONE);
    expect(priceTypes.filter((value) => value === PRICE_TYPE_NONE)).toHaveLength(1);
    expect(priceTypes).toContain('정상판매');
    expect(priceTypes).not.toEqual(expect.arrayContaining(['', '—', '   ']));
    const rest = priceTypes.slice(0, -1);
    expect(rest).toEqual([...rest].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const defs = priceFilterDefs(currencies, priceTypes);
    const parse = (params: Record<string, string>) => parsePriceFilter(params, defs).filter.filters;
    expect(parse({ 'f.priceType.in': 'no-such-type' })).toBeUndefined();
    expect(parse({ 'f.priceType.in': 'apple,no-such-type' })).toBeUndefined();
    expect(parse({ 'f.priceType.has': 'app', 'f.priceType.eq': 'apple' })).toBeUndefined();
    expect(parse({ 'f.priceType.in': `${PRICE_TYPE_NONE},apple` })).toEqual([
      { col: 'priceType', op: 'in', values: [PRICE_TYPE_NONE, 'apple'] },
    ]);
  });

  it('SQL 에 사용자 값 보간 0 — 값은 params 에만', () => {
    const evil = `x'); drop table sales_prices;--%_\\`;
    const conds: FilterCondition[] = [
      { col: 'remark', op: 'has', value: evil },
      { col: 'remark', op: 'eq', value: evil },
      { col: 'priceType', op: 'in', values: [evil, PRICE_TYPE_NONE] },
      { col: 'status', op: 'in', values: ["운영중'--"] },
      { col: 'currency', op: 'in', values: ['KRW'] },
      { col: 'price', op: 'gte', value: '1000' },
      { col: 'priceChange', op: 'lte', value: '-5.5' },
    ];
    const spec = buildFilterSpec(priceFilterDefs(['KRW']), PRICE_FILTER_SQL, {
      emptyValues: { priceType: PRICE_TYPE_NONE },
    });
    const query = handle.db
      .select({ id: salesPrices.id })
      .from(salesPrices)
      .leftJoin(items, eq(items.itemCode, salesPrices.itemCode))
      .where(and(...filterSqlConditions(conds, spec)))
      .toSQL();
    for (const value of [evil, "운영중'--", '1000', '-5.5', 'drop table', PRICE_TYPE_NONE])
      expect(query.sql).not.toContain(value);
    expect(query.params).toEqual(
      expect.arrayContaining([evil, "운영중'--", 'KRW', '1000', '-5.5']),
    );
    expect(query.sql).toContain('strpos(lower(');
    expect(query.sql).toContain('collate "C"');
  });
});

// ───────────────────────── 원가 ─────────────────────────

describe('원가 표 서버 필터 — 클라이언트 술어와 일치', () => {
  let currencies: string[];
  let all: CostRow[];
  const nonEmpty: boolean[] = [];
  const fetchCosts = (params: Record<string, string>) =>
    allPages((page) => {
      const { filter } = parseCostFilter(
        { ...params, page: String(page) },
        costFilterDefs(currencies),
      );
      return getCostRows(access, handle.db, filter);
    });

  beforeAll(async () => {
    currencies = await listCostCurrencies(access, handle.db);
    all = (await fetchCosts({})).rows;
  });

  const CASES: Record<string, Record<string, string>> = {
    '단위 "apple" 포함 + 상태 운영중': { 'f.unit.has': 'apple', 'f.status.in': '운영중' },
    '통화 JPY + 원가 200~500': { 'f.currency.in': 'JPY', 'f.cost.gte': '200', 'f.cost.lte': '500' },
    '단위 "zeta" 같음 + 통화 2개(원가 범위 비활성) + 원가 ≤ 300': {
      'f.unit.eq': 'zeta',
      'f.currency.in': 'KRW,USD',
      'f.cost.lte': '300',
    },
    '제품군 탭 + 열 필터': { family: 'WAPPLES', 'f.status.in': '미사용', 'f.unit.has': 'a' },
  };

  for (const [name, params] of Object.entries(CASES)) {
    it(name, async () => {
      const fields = costFilterFields(currencies);
      const conds = parseFilterParams(params, filterDefsOf(fields));
      expect(conds.length).toBeGreaterThanOrEqual(2);
      const server = await fetchCosts(params);
      const base = params.family ? (await fetchCosts({ family: params.family })).rows : all;
      const client = filterRows(base, conds, filterAccessorsOf(fields), filterDefsOf(fields));
      expect(ids(server.rows)).toEqual(ids(client));
      expect(server.total).toBe(client.length);
      nonEmpty.push(server.total > 0 && server.total < all.length);
    });
  }

  it('대부분의 케이스가 공집합·전체가 아닌 결과를 낸다 (일치 비교가 의미 있도록)', () => {
    expect(nonEmpty.filter(Boolean).length).toBeGreaterThanOrEqual(Object.keys(CASES).length - 1);
  });

  it('같은 의미 열(코드·원자재명·적용시작일·적용기간)은 열 필터 없음, 화이트리스트 밖은 무시', () => {
    const defs = costFilterDefs(currencies);
    expect(Object.keys(defs)).toEqual(['unit', 'currency', 'cost', 'status']);
    expect(
      parseCostFilter(
        {
          'f.code.has': 'M',
          'f.name.has': 'm',
          'f.effectiveFrom.gte': '2020-01-01',
          'f.period.gte': '2020-01-01',
          'f.unit.like': 'a',
          'f.cost.in': '1',
        },
        defs,
      ).filter.filters,
    ).toBeUndefined();
  });

  it('SQL 에 사용자 값 보간 0', () => {
    const evil = `'; delete from material_costs;--`;
    const spec = buildFilterSpec(costFilterDefs(['KRW']), COST_FILTER_SQL);
    const query = handle.db
      .select({ id: materialCosts.id })
      .from(materialCosts)
      .where(
        and(
          ...filterSqlConditions(
            [
              { col: 'unit', op: 'has', value: evil },
              { col: 'currency', op: 'in', values: ['KRW'] },
              { col: 'cost', op: 'lte', value: '12.5' },
            ],
            spec,
          ),
        ),
      )
      .toSQL();
    expect(query.sql).not.toContain(evil);
    expect(query.sql).not.toContain('12.5');
    expect(query.params).toEqual(expect.arrayContaining([evil, 'KRW', '12.5']));
  });
});

// ───────────────────────── 감사 ─────────────────────────

describe('감사 표 서버 필터 — 별칭·클라이언트 술어·CSV 일치', () => {
  let actions: string[];
  let all: Awaited<ReturnType<typeof getAuditLogs>>['rows'];
  const nonEmpty: boolean[] = [];
  const fetchAudit = (params: Record<string, string>) =>
    allPages((page) =>
      getAuditLogs(handle.db, parseAuditFilter({ ...params, page: String(page) })),
    );

  beforeAll(async () => {
    actions = await listAuditActions(handle.db);
    all = (await fetchAudit({})).rows;
  });

  const CASES: Record<string, Record<string, string>> = {
    '기간(from·to, KST) + 행위 다중(action=a,b)': {
      from: '2026-09-03',
      to: '2026-09-06',
      action: 'auth.login,user.update',
    },
    '사용자 "apple" 포함(actor) + 결과 거부·오류': {
      actor: 'apple',
      'f.result.in': 'denied,error',
    },
    '대상 "user" 포함 + IP "10." 포함': { 'f.target.has': 'a', 'f.ip.has': '10.' },
    '사용자 "zeta" 같음(f.actor.eq) + 종료일': { 'f.actor.eq': 'zeta', to: '2026-09-10' },
    'IP "::1" 같음 + 결과 성공 + 옛 단일 행위': {
      'f.ip.eq': '::1',
      'f.result.in': 'success',
      action: 'auth.login',
    },
  };

  for (const [name, params] of Object.entries(CASES)) {
    it(name, async () => {
      const filter = parseAuditFilter(params);
      const fields = auditFilterFields(actions);
      // 별칭 포함 조건 (툴바와 같은 auditConditions 경로)
      const conds = auditConditions(filter);
      expect(conds.length).toBeGreaterThanOrEqual(2);
      const server = await fetchAudit(params);
      const client = filterRows(all, conds, filterAccessorsOf(fields), filterDefsOf(fields));
      expect(ids(server.rows)).toEqual(ids(client));
      expect(server.total).toBe(client.length);
      nonEmpty.push(server.total > 0 && server.total < all.length);
    });
  }

  it('대부분의 케이스가 공집합·전체가 아닌 결과를 낸다 (일치 비교가 의미 있도록)', () => {
    expect(nonEmpty.filter(Boolean).length).toBeGreaterThanOrEqual(Object.keys(CASES).length - 1);
  });

  it('옛 URL ?action=X 는 그대로 동작하고, 다중 action 은 쉼표로 왕복한다', async () => {
    const single = parseAuditFilter({ action: 'user.update' });
    expect(single.action).toEqual(['user.update']);
    expect((await getAuditLogs(handle.db, single)).total).toBe(
      all.filter((row) => row.action === 'user.update').length,
    );
    const multi = parseAuditFilter({ action: 'user.update, auth.login,user.update' });
    expect(multi.action).toEqual(['user.update', 'auth.login']);
    expect(auditQuery(multi)).toBe('?action=user.update%2Cauth.login');
    expect(
      parseAuditFilter(Object.fromEntries(new URLSearchParams(auditQuery(multi)))).action,
    ).toEqual(['user.update', 'auth.login']);
    // 모르는 행위 = 결과 없음 (옛 동작과 같음)
    expect((await getAuditLogs(handle.db, parseAuditFilter({ action: 'no.such' }))).total).toBe(0);
  });

  it('별칭 열의 f.* 키·화이트리스트 밖·잘못된 날짜는 무시', () => {
    const filter = parseAuditFilter({
      'f.createdAt.gte': '2026-09-01',
      'f.action.in': 'auth.login',
      'f.actor.has': 'kim',
      'f.before.has': 'x',
      'f.result.in': 'success,bogus',
      'f.x;drop.has': '1',
      from: '2026-02-30',
    });
    expect(filter).toEqual({
      from: undefined,
      to: undefined,
      action: undefined,
      actor: undefined,
      page: 1,
    });
  });

  it('별칭 포함 전체 열·연산자 10개(= 조건 한도)를 모두 받는다', () => {
    const filter = parseAuditFilter({
      from: '2026-09-01',
      to: '2026-09-30',
      action: 'a',
      actor: 'b',
      'f.actor.eq': 'c',
      'f.target.has': 'd',
      'f.target.eq': 'e',
      'f.ip.has': 'f',
      'f.ip.eq': 'g',
      'f.result.in': 'success',
    });
    expect(auditConditions(filter)).toHaveLength(FILTER_LIMITS.conditionsMax);
    expect(filter.filters).toHaveLength(6);
  });

  it('CSV 라우트는 화면 href(filterToQuery)의 필터를 그대로 적용한다 — 화면 total == CSV 행 수', async () => {
    const { GET } = await import('@/app/api/audit/export.csv/route');
    const params = {
      from: '2026-09-02',
      action: 'auth.login,price_policy.create',
      'f.result.in': 'success,error',
      sort: 'actor',
      dir: 'desc',
    };
    const filter = parseAuditFilter(params);
    const href = `/api/audit/export.csv${auditQuery({ ...filter, page: 1 })}`;
    expect(href).toContain('action=auth.login%2Cprice_policy.create');
    expect(href).toContain('f.result.in=success%2Cerror');
    expect(href).toMatch(/&sort=actor&dir=desc$/);
    const response = await GET(new Request(`http://localhost${href}`));
    const lines = (await response.text()).slice(1).trim().split('\r\n');
    const screen = await getAuditLogs(handle.db, filter);
    expect(screen.total).toBeGreaterThan(0);
    expect(lines.length - 1).toBe(screen.total);
    expect((await getAuditLogsForExport(handle.db, filter)).map((row) => row.id)).toEqual(
      (await fetchAudit(params)).rows.map((row) => row.id),
    );
  });

  it('SQL 에 사용자 값 보간 0', () => {
    const spec = buildFilterSpec(auditFilterDefs([]), AUDIT_FILTER_SQL);
    const evil = `'||pg_sleep(1)||'`;
    const query = handle.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          ...filterSqlConditions(
            [
              { col: 'actor', op: 'has', value: evil },
              { col: 'action', op: 'in', values: [evil] },
              { col: 'target', op: 'eq', value: evil },
              { col: 'createdAt', op: 'gte', value: '2026-09-01' },
            ],
            spec,
          ),
        ),
      )
      .toSQL();
    expect(query.sql).not.toContain('pg_sleep');
    expect(query.sql).not.toContain('2026-09-01');
    expect(query.params.filter((value) => value === evil)).toHaveLength(3);
  });
});
