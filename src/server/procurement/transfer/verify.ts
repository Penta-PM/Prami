import { sql, type SQL } from 'drizzle-orm';

import { queryRows, type Executor } from '@/server/imports/sql-rows';
import type { VerifyCheck, VerifyReport, VerifyStatus } from '@/server/ops/data-verify';

import { columnList, sourceRelation, targetRelation } from './sql';
import {
  PROCUREMENT_TABLE_NAMES,
  PROCUREMENT_TABLES,
  quoteIdent,
  type ProcurementTableName,
  type SourceData,
} from './tables';

/**
 * `data:verify --stage procurement` (DB-3) — 이관 결과를 원본과 대조한다. **읽기 전용**(SELECT 만, 호출자가 READ ONLY 트랜잭션).
 * 원본 쪽 수치는 저장소에 두지 않고 실행 시 원본(CSV 디렉터리·원본 DB)에서 계산한다 — 원본 행을 대상 DB 에서 같은 타입 캐스트로
 * SELECT 해(쓰지 않음) 두 쪽 표현을 맞춘다.
 * 항목: 테이블·뷰 건수, items (status, product) 분포, 연도별 금액 합계(deliveries 전체 · v_product_deliveries 제품별),
 * 최대 id(원본 대비)·시퀀스(= max(id)), 테이블별 정렬 해시(기본 키 순서 행 텍스트의 md5).
 * 출력은 건수와 일치 여부만 — 금액 원문은 `showAmounts` 일 때만, 해시 값은 출력하지 않는다.
 * 원본이 없으면 대상 실측(MEASURED)과 시퀀스 규칙만 본다.
 */
export type ProcurementVerifyOptions = { source?: SourceData; showAmounts?: boolean };

type Relation = (table: ProcurementTableName) => SQL;

type Metrics = {
  tables: Record<ProcurementTableName, number>;
  views: Record<ViewName, number>;
  statusProduct: Record<string, number>;
  yearSums: Record<string, AmountRow>;
  productYearSums: Record<string, AmountRow>;
  maxIds: Partial<Record<ProcurementTableName, string | null>>;
  hashes: Record<ProcurementTableName, string>;
};
type AmountRow = { n: number; amounts: string };

const VIEW_NAMES = ['v_deliveries', 'v_product_deliveries', 'v_item_prices'] as const;
type ViewName = (typeof VIEW_NAMES)[number];

/** 0012 뷰와 같은 규칙을 임의의 관계(원본 하위 질의)에 적용 — 원본 쪽 뷰 수치 계산용 */
function derivedViews(rel: Relation): Record<ViewName, SQL> {
  const vDeliveries = sql`select distinct on ("dlvr_req_no", "item_id") * from ${rel('deliveries')}
    where not "excluded" order by "dlvr_req_no", "item_id", "change_ord"`;
  return {
    v_deliveries: vDeliveries,
    v_product_deliveries: sql`select "items"."product", "d".* from (${vDeliveries}) "d"
      join ${rel('items')} on "items"."item_id" = "d"."item_id"
      where "items"."status" = 'active' and "items"."product" <> '기타'`,
    v_item_prices: sql`select distinct on ("item_id") "item_id" from (${vDeliveries}) "d"
      where "unit_price" is not null and "unit_price" > 0 order by "item_id", "dlvr_req_date" desc`,
  };
}

const targetViews: Record<ViewName, SQL> = {
  v_deliveries: sql`select * from procurement.v_deliveries`,
  v_product_deliveries: sql`select * from procurement.v_product_deliveries`,
  v_item_prices: sql`select * from procurement.v_item_prices`,
};

async function count(db: Executor, query: SQL): Promise<number> {
  const [row] = await queryRows<{ n: number | string }>(db, query);
  return Number(row?.n ?? 0);
}

async function keyed<T extends { k: string }>(
  db: Executor,
  query: SQL,
): Promise<Record<string, T>> {
  const rows = await queryRows<T>(db, query);
  return Object.fromEntries(rows.map((row) => [row.k, row]));
}

async function collect(
  db: Executor,
  rel: Relation,
  views: Record<ViewName, SQL>,
): Promise<Metrics> {
  const tables = {} as Record<ProcurementTableName, number>;
  const hashes = {} as Record<ProcurementTableName, string>;
  const maxIds: Metrics['maxIds'] = {};
  for (const table of PROCUREMENT_TABLE_NAMES) {
    const spec = PROCUREMENT_TABLES[table];
    tables[table] = await count(db, sql`select count(*)::int as n from ${rel(table)}`);
    const alias = sql.raw(quoteIdent(table));
    const [hash] = await queryRows<{ h: string }>(
      db,
      sql`select md5(coalesce(string_agg(r.t, E'\\n' order by r.k), '')) as h
          from (select row(${columnList(table)})::text as t, ${alias}.${sql.raw(quoteIdent(spec.key))} as k
                from ${rel(table)}) r`,
    );
    hashes[table] = hash?.h ?? '';
    if (spec.serial) {
      const [row] = await queryRows<{ m: string | null }>(
        db,
        sql`select max("id")::text as m from ${rel(table)}`,
      );
      maxIds[table] = row?.m ?? null;
    }
  }
  const viewCounts = {} as Record<ViewName, number>;
  for (const view of VIEW_NAMES) {
    viewCounts[view] = await count(db, sql`select count(*)::int as n from (${views[view]}) v`);
  }
  const statusProduct = Object.fromEntries(
    Object.values(
      await keyed<{ k: string; n: number }>(
        db,
        sql`select "status" || ' / ' || "product" as k, count(*)::int as n from ${rel('items')} group by 1`,
      ),
    ).map((row) => [row.k, Number(row.n)]),
  );
  const yearKey = sql`coalesce(extract(year from "dlvr_req_date")::int::text, '날짜 없음')`;
  const toAmounts = (rows: Record<string, { k: string; n: number; a: string; t: string }>) =>
    Object.fromEntries(
      Object.values(rows).map((row) => [
        row.k,
        { n: Number(row.n), amounts: `amount ${row.a} · total_amount ${row.t}` },
      ]),
    );
  const yearSums = toAmounts(
    await keyed(
      db,
      sql`select ${yearKey} as k, count(*)::int as n, coalesce(sum("amount"), 0)::text as a,
          coalesce(sum("total_amount"), 0)::text as t from ${rel('deliveries')} group by 1`,
    ),
  );
  const productYearSums = toAmounts(
    await keyed(
      db,
      sql`select ${yearKey} || ' ' || "product" as k, count(*)::int as n,
          coalesce(sum("amount"), 0)::text as a, coalesce(sum("total_amount"), 0)::text as t
          from (${views.v_product_deliveries}) v group by 1`,
    ),
  );
  return {
    tables,
    views: viewCounts,
    statusProduct,
    yearSums,
    productYearSums,
    maxIds,
    hashes,
  };
}

const fmtDist = (dist: Readonly<Record<string, number>>) =>
  Object.keys(dist)
    .sort()
    .map((key) => `${key} ${dist[key]}`)
    .join(' / ') || '(없음)';

function sameDist(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[key] ?? 0) === (b[key] ?? 0));
}

class Checks {
  readonly list: VerifyCheck[] = [];
  constructor(private readonly hasSource: boolean) {}
  /** 원본 대비 비교 — 원본이 없으면 실측만(MEASURED) */
  compare(id: string, label: string, expected: string, actual: string, ok: boolean): void {
    if (!this.hasSource) {
      this.add(id, label, '-', actual, 'MEASURED');
      return;
    }
    this.add(id, label, expected, actual, ok ? 'PASS' : 'FAIL');
  }
  rule(id: string, label: string, expected: string, actual: string, ok: boolean): void {
    this.add(id, label, expected, actual, ok ? 'PASS' : 'FAIL');
  }
  add(id: string, label: string, expected: string, actual: string, status: VerifyStatus): void {
    this.list.push({ id, label, expected, actual, status });
  }
}

async function sequenceChecks(db: Executor, checks: Checks, maxIds: Metrics['maxIds']) {
  for (const table of PROCUREMENT_TABLE_NAMES) {
    if (!PROCUREMENT_TABLES[table].serial) continue;
    const [row] = await queryRows<{ v: string | null }>(
      db,
      sql`select s.last_value::text as v from pg_sequences s
          where quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename)
            = pg_get_serial_sequence(${`procurement.${quoteIdent(table)}`}, 'id')`,
    );
    const max = maxIds[table] ?? null;
    const last = row?.v ?? null;
    checks.rule(
      `procurement.seq.${table}`,
      `시퀀스 ${table}_id_seq = max(id)`,
      max ?? '미호출(빈 표)',
      last ?? '미호출',
      last === max,
    );
  }
}

export async function verifyProcurement(
  db: Executor,
  options: ProcurementVerifyOptions = {},
): Promise<VerifyReport> {
  const hasSource = Boolean(options.source);
  const checks = new Checks(hasSource);
  const [schema] = await queryRows<{ ok: boolean }>(
    db,
    sql`select to_regclass('procurement.items') is not null as ok`,
  );
  if (!schema?.ok) {
    checks.rule('procurement.schema', 'procurement 스키마(0012)', '있음', '없음', false);
    return { checks: checks.list, exitCode: 1, sourceChanged: false };
  }
  const target = await collect(db, targetRelation, targetViews);
  const source = options.source
    ? await collect(
        db,
        (table) => sourceRelation(table, options.source![table]),
        derivedViews((table) => sourceRelation(table, options.source![table])),
      )
    : undefined;
  const show = options.showAmounts === true;

  for (const table of PROCUREMENT_TABLE_NAMES) {
    const expected = source?.tables[table] ?? 0;
    checks.compare(
      `procurement.count.${table}`,
      `건수 ${table}`,
      String(expected),
      String(target.tables[table]),
      expected === target.tables[table],
    );
  }
  for (const view of VIEW_NAMES) {
    const expected = source?.views[view] ?? 0;
    checks.compare(
      `procurement.count.${view}`,
      `건수 ${view}`,
      String(expected),
      String(target.views[view]),
      expected === target.views[view],
    );
  }
  checks.compare(
    'procurement.items.status_product',
    'items (status / product) 분포',
    fmtDist(source?.statusProduct ?? {}),
    fmtDist(target.statusProduct),
    sameDist(source?.statusProduct ?? {}, target.statusProduct),
  );

  const amountChecks = (
    prefix: string,
    label: string,
    expected: Record<string, AmountRow> | undefined,
    actual: Record<string, AmountRow>,
  ) => {
    const keys = [...new Set([...Object.keys(expected ?? {}), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      const e = expected?.[key];
      const a = actual[key];
      const ok = Boolean(e && a && e.n === a.n && e.amounts === a.amounts);
      const render = (row: AmountRow | undefined, other: AmountRow | undefined) => {
        if (!row) return '없음';
        if (show) return `${row.n}건 · ${row.amounts}`;
        if (!hasSource) return `${row.n}건 · 금액 숨김`;
        return `${row.n}건 · 금액 ${other && row.amounts === other.amounts ? '일치' : '불일치'}`;
      };
      checks.compare(`${prefix}.${key}`, `${label} ${key}`, render(e, a), render(a, e), ok);
    }
  };
  amountChecks(
    'procurement.sum.deliveries',
    '연도별 금액 deliveries',
    source?.yearSums,
    target.yearSums,
  );
  amountChecks(
    'procurement.sum.product',
    '연도별 금액 v_product_deliveries',
    source?.productYearSums,
    target.productYearSums,
  );

  for (const table of PROCUREMENT_TABLE_NAMES) {
    if (!PROCUREMENT_TABLES[table].serial) continue;
    const expected = source?.maxIds[table] ?? null;
    const actual = target.maxIds[table] ?? null;
    checks.compare(
      `procurement.maxid.${table}`,
      `최대 id ${table}`,
      expected ?? '(빈 표)',
      actual ?? '(빈 표)',
      expected === actual,
    );
  }
  await sequenceChecks(db, checks, target.maxIds);

  for (const table of PROCUREMENT_TABLE_NAMES) {
    if (!source) {
      checks.add(`procurement.hash.${table}`, `정렬 해시 ${table}`, '-', '원본 없음', 'SKIP');
      continue;
    }
    const ok = source.hashes[table] === target.hashes[table];
    checks.rule(
      `procurement.hash.${table}`,
      `정렬 해시 ${table}`,
      '원본과 같음',
      ok ? '일치' : '불일치',
      ok,
    );
  }

  const failed = checks.list.some((check) => check.status === 'FAIL');
  return { checks: checks.list, exitCode: failed ? 1 : 0, sourceChanged: false };
}
