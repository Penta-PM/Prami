import { sql, type SQL } from 'drizzle-orm';

import { FIXTURE_EMAIL_LIKE } from '@/lib/constants/fixture';
import { countMaterialCostRows } from '@/server/cost/row-count';
import { queryCount, queryRows, type Executor } from '@/server/imports/sql-rows';
import { countAllCredentials } from '@/server/llm/credentials/repository';

import { DATA_BASELINE, type DataBaseline } from './data-baseline';
import {
  BUNDLED_JOURNAL,
  compareSchema,
  latestAppliedMigration,
  latestJournalEntry,
  type MigrationJournal,
} from './schema-version';

/**
 * 데이터 자동 검증 (PRAMI-003 §4.9.2, AC-331·332). **읽기 전용** — SELECT 만 쓰고 호출자가 READ ONLY 트랜잭션으로 감싼다.
 * 결과는 항목·기대·실측·판정 표이며 개수·상태 라벨만 담는다(이메일·이름·품명·금액 없음).
 * - stage schema: 저널 최신 = DB 최신, 마이그레이션 행 수
 * - stage data(기본): 위 + 품목·판매단가·운영상태·불변식·원가 수치. 적용 배치 SHA-256 이 기준과 다르면 수치 비교 대신 실측(exit 2)
 * - fresh: 시연·업무 데이터 0 검사 추가(클린 설치 직후용)
 */
export type VerifyStatus = 'PASS' | 'FAIL' | 'MEASURED' | 'SKIP';
export type VerifyCheck = {
  id: string;
  label: string;
  expected: string;
  actual: string;
  status: VerifyStatus;
};
export type VerifyReport = { checks: VerifyCheck[]; exitCode: 0 | 1 | 2; sourceChanged: boolean };

export type VerifyOptions = {
  stage: 'schema' | 'data';
  fresh: boolean;
  allowPartMappings: boolean;
  /** 로컬 대상은 로그인 전(사용자 0명)이면 ADMIN 검사를 SKIP — 원격은 관리자 로그인(S-3)이 적재보다 먼저라 필수 */
  requireAdmin: boolean;
  allowedDomains: readonly string[];
  baseline?: DataBaseline;
  journal?: MigrationJournal;
};

type Distribution = Record<string, number>;

const fmt = (value: number | string) => String(value);
const fmtDist = (dist: Readonly<Distribution>) =>
  Object.keys(dist)
    .sort()
    .map((key) => `${key} ${dist[key]}`)
    .join(' / ');

function sameDist(a: Readonly<Distribution>, b: Readonly<Distribution>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[key] ?? 0) === (b[key] ?? 0));
}

async function distribution(db: Executor, query: SQL): Promise<Distribution> {
  const rows = await queryRows<{ k: string | null; n: number | string }>(db, query);
  return Object.fromEntries(rows.map((row) => [row.k ?? '(없음)', Number(row.n)]));
}

const count = (db: Executor, query: SQL) => queryCount(db, query);

class Checks {
  readonly list: VerifyCheck[] = [];
  constructor(private readonly measureOnly: boolean) {}

  /** 수치 비교. 원본이 바뀌었으면(measureOnly) 판정 없이 실측만 */
  value(id: string, label: string, expected: number, actual: number) {
    this.push(id, label, fmt(expected), fmt(actual), actual === expected, true);
  }

  dist(id: string, label: string, expected: Readonly<Distribution>, actual: Distribution) {
    this.push(id, label, fmtDist(expected), fmtDist(actual), sameDist(expected, actual), true);
  }

  /** 원본과 무관한 규칙(불변식·시연 데이터 0)은 항상 판정한다 */
  rule(id: string, label: string, expected: string, actual: string, ok: boolean) {
    this.push(id, label, expected, actual, ok, false);
  }

  skip(id: string, label: string, expected: string, reason: string) {
    this.list.push({ id, label, expected, actual: reason, status: 'SKIP' });
  }

  private push(
    id: string,
    label: string,
    expected: string,
    actual: string,
    ok: boolean,
    sourceBound: boolean,
  ) {
    const status: VerifyStatus =
      sourceBound && this.measureOnly ? 'MEASURED' : ok ? 'PASS' : 'FAIL';
    this.list.push({ id, label, expected, actual, status });
  }
}

async function schemaChecks(
  db: Executor,
  checks: Checks,
  options: VerifyOptions,
  baseline: DataBaseline,
) {
  const journal = options.journal ?? BUNDLED_JOURNAL;
  const latest = latestJournalEntry(journal);
  const latestApplied = await latestAppliedMigration(db);
  const state = compareSchema(latest?.when ?? null, latestApplied);
  checks.rule('schema.latest', '스키마 최신(저널 = DB)', latest?.tag ?? '-', state, state === 'ok');
  // 마이그레이션 테이블이 없으면(빈 DB) 0
  const applied =
    latestApplied === null
      ? 0
      : await count(db, sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
  checks.rule(
    'schema.migrations',
    '__drizzle_migrations 행',
    fmt(baseline.expected.migrations),
    fmt(applied),
    applied === baseline.expected.migrations && applied === journal.entries.length,
  );
}

type AppliedBatch = { kind: string; sha: string; files: string[] };

async function appliedBatches(db: Executor): Promise<AppliedBatch[]> {
  const rows = await queryRows<{ kind: string; sha: string; files: string[] | null }>(
    db,
    sql`select kind::text as kind, file_sha256 as sha,
          (select array_agg(f->>'sha256' order by f->>'sha256') from jsonb_array_elements(coalesce(source_files, '[]'::jsonb)) f) as files
        from import_batches where status = 'applied' order by kind, created_at`,
  );
  return rows.map((row) => ({ kind: row.kind, sha: row.sha, files: row.files ?? [] }));
}

/** 적용 배치의 원본 해시가 기준과 같은지 — 다르면 수치는 실측만 (배치가 없으면 비교 대상 아님 → false) */
function sourceChangedFrom(batches: AppliedBatch[], baseline: DataBaseline): boolean {
  const byKind = (kind: string) => batches.filter((batch) => batch.kind === kind);
  const sales = byKind('sales_price');
  const costs = byKind('material_cost');
  const items = byKind('item_master');
  const expectedItems = [...baseline.sources.items].sort().join(',');
  return (
    sales.some((batch) => batch.sha !== baseline.sources.sales) ||
    costs.some((batch) => batch.sha !== baseline.sources.costs) ||
    items.some((batch) => [...batch.files].sort().join(',') !== expectedItems)
  );
}

async function dataChecks(db: Executor, checks: Checks, baseline: DataBaseline) {
  const e = baseline.expected;
  checks.value(
    'items.total',
    '품목 전체',
    e.items,
    await count(db, sql`select count(*)::int as n from items`),
  );
  checks.value(
    'items.master',
    '품목 master',
    e.items,
    await count(db, sql`select count(*)::int as n from items where source = 'master'`),
  );
  const stubs = await count(db, sql`select count(*)::int as n from items where source = 'stub'`);
  checks.rule('items.stub', '품목 stub', '0', fmt(stubs), stubs === 0);
  checks.dist(
    'items.status',
    '품목 상태',
    e.itemStatus,
    await distribution(
      db,
      sql`select item_status::text as k, count(*)::int as n from items group by 1`,
    ),
  );
  checks.dist(
    'items.major',
    '대분류',
    e.itemMajor,
    await distribution(
      db,
      sql`select category_major as k, count(*)::int as n from items group by 1`,
    ),
  );
  checks.dist(
    'items.kind',
    '품목 종류',
    e.itemKind,
    await distribution(
      db,
      sql`select item_kind::text as k, count(*)::int as n from items group by 1`,
    ),
  );
  checks.value(
    'sales.rows',
    '판매단가 행(삭제 제외)',
    e.salesRows,
    await count(db, sql`select count(*)::int as n from sales_prices where deleted_at is null`),
  );
  checks.value(
    'sales.series',
    '판매단가 계열',
    e.salesSeries,
    await count(
      db,
      sql`select count(distinct series_key)::int as n from sales_prices where deleted_at is null`,
    ),
  );
  checks.value(
    'sales.latest',
    '계열 최신 행',
    e.salesLatest,
    await count(
      db,
      sql`select count(*)::int as n from sales_prices where deleted_at is null and is_latest_in_series`,
    ),
  );
  checks.value(
    'sales.operating',
    '운영중',
    e.operating,
    await count(
      db,
      sql`select count(*)::int as n from sales_prices where deleted_at is null and operation_status = '운영중'`,
    ),
  );
  checks.value(
    'sales.unused',
    '미사용',
    e.unused,
    await count(
      db,
      sql`select count(*)::int as n from sales_prices where deleted_at is null and operation_status = '미사용'`,
    ),
  );
  await invariantChecks(db, checks);
  checks.value('costs.rows', '원가 행(삭제 제외)', e.costRows, await countMaterialCostRows(db));
}

async function invariantChecks(db: Executor, checks: Checks) {
  const i1 = await count(
    db,
    sql`select count(*)::int as n from sales_prices sp join items i on i.item_code = sp.item_code
        where sp.deleted_at is null and i.item_status = '폐기' and sp.operation_status = '운영중'`,
  );
  checks.rule('inv.i1', 'I-1 폐기 ∧ 운영중', '0', fmt(i1), i1 === 0);
  const i2 = await count(
    db,
    sql`select count(*)::int as n from (select series_key from sales_prices where deleted_at is null
        group by series_key having count(*) filter (where is_latest_in_series) <> 1) bad`,
  );
  checks.rule('inv.i2', 'I-2 계열당 최신 ≠ 1', '0', fmt(i2), i2 === 0);
  const i10 = await count(
    db,
    sql`select count(distinct sp.item_code)::int as n from sales_prices sp join items i on i.item_code = sp.item_code
        where sp.deleted_at is null and i.source = 'master' and i.category_major <> sp.product_family`,
  );
  checks.rule('inv.i10', 'I-10 대분류 ≠ 판매단가 제품군', '0', fmt(i10), i10 === 0);
}

const ZERO_TABLES = [
  'notices',
  'notifications',
  'quotes',
  'quote_lines',
  'quote_shares',
  'solution_groups',
  'solution_group_items',
  'oauth_flow_states',
] as const;

async function freshChecks(db: Executor, checks: Checks, options: VerifyOptions) {
  const fixtures = await count(
    db,
    sql`select count(*)::int as n from users where email like ${FIXTURE_EMAIL_LIKE}`,
  );
  checks.rule('fresh.fixture', 'fixture 계정', '0', fmt(fixtures), fixtures === 0);
  const users = await count(db, sql`select count(*)::int as n from users`);
  const admins = await count(
    db,
    sql`select count(*)::int as n from users where role = 'ADMIN' and status = 'active'`,
  );
  if (users === 0 && !options.requireAdmin) {
    checks.skip(
      'fresh.admin',
      '활성 ADMIN',
      '≥ 1',
      '사용자 0명(로그인 전) — 첫 관리자 로그인 후 다시 실행',
    );
  } else {
    checks.rule('fresh.admin', '활성 ADMIN', '≥ 1', fmt(admins), admins >= 1);
  }
  const domains = options.allowedDomains.map((domain) => domain.toLowerCase());
  const outside = await count(
    db,
    sql`select count(*)::int as n from users where lower(split_part(email::text, '@', 2)) <> all(${`{${domains.join(',')}}`}::text[])`,
  );
  checks.rule('fresh.domain', '허용 도메인 밖 사용자', '0', fmt(outside), outside === 0);
  for (const table of ZERO_TABLES) {
    const rows = await count(db, sql`select count(*)::int as n from ${sql.identifier(table)}`);
    checks.rule(`fresh.${table}`, `${table} 행`, '0', fmt(rows), rows === 0);
  }
  // 자격 증명 테이블은 credentials 모듈만 다룬다 (PRAMI-002 T-7) — 개수 함수만 빌려 쓴다
  const credentials = await countAllCredentials(db);
  checks.rule('fresh.credentials', 'LLM 자격 증명 행', '0', fmt(credentials), credentials === 0);
  const mappings = await count(db, sql`select count(*)::int as n from part_mappings`);
  if (options.allowPartMappings) {
    checks.rule(
      'fresh.part_mappings',
      'part_mappings 행(관리자 적재)',
      '검사 생략',
      fmt(mappings),
      true,
    );
  } else {
    checks.rule('fresh.part_mappings', 'part_mappings 행', '0', fmt(mappings), mappings === 0);
  }
  const seedAudit = await count(
    db,
    sql`select count(*)::int as n from audit_logs where actor_label = 'seed'`,
  );
  checks.rule('fresh.seed_audit', "감사 actor 'seed'", '0', fmt(seedAudit), seedAudit === 0);
  await importHistoryChecks(db, checks);
}

async function importHistoryChecks(db: Executor, checks: Checks) {
  const perKind = await distribution(
    db,
    sql`select kind::text as k, count(*)::int as n from import_batches
        where status in ('applied', 'superseded') group by 1`,
  );
  const expected = { item_master: 1, material_cost: 1, sales_price: 1 };
  checks.rule(
    'fresh.batches',
    '적용 배치(종류별)',
    fmtDist(expected),
    fmtDist(perKind),
    sameDist(expected, perKind),
  );
  const runs = await count(
    db,
    sql`select count(*)::int as n from policy_apply_runs where status = 'succeeded'`,
  );
  checks.rule('fresh.runs', '적용 실행 succeeded', '≥ 1', fmt(runs), runs >= 1);
}

export async function verifyData(db: Executor, options: VerifyOptions): Promise<VerifyReport> {
  const baseline = options.baseline ?? DATA_BASELINE;
  if (options.stage === 'schema') {
    const checks = new Checks(false);
    await schemaChecks(db, checks, options, baseline);
    return finish(checks, false);
  }
  const sourceChanged = sourceChangedFrom(await appliedBatches(db), baseline);
  const checks = new Checks(sourceChanged);
  await schemaChecks(db, checks, options, baseline);
  await dataChecks(db, checks, baseline);
  if (options.fresh) await freshChecks(db, checks, options);
  return finish(checks, sourceChanged);
}

function finish(checks: Checks, sourceChanged: boolean): VerifyReport {
  const failed = checks.list.some((check) => check.status === 'FAIL');
  return { checks: checks.list, sourceChanged, exitCode: failed ? 1 : sourceChanged ? 2 : 0 };
}

export function formatReport(report: VerifyReport): string {
  const rows = report.checks.map(
    (check) => `| ${check.label} | ${check.expected} | ${check.actual} | ${check.status} |`,
  );
  const lines = ['| 항목 | 기대 | 실측 | 판정 |', '| --- | --- | --- | --- |', ...rows];
  if (report.sourceChanged) {
    lines.push(
      '',
      '원본이 바뀌었음 — 적용 배치의 SHA-256 이 기준과 다릅니다. Plan 기준값 재계산 필요 (exit 2)',
    );
  }
  return lines.join('\n');
}
