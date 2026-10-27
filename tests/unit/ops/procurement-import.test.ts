// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { withTransaction } from '@/db/tx';
import { queryCount, queryRows } from '@/server/imports/sql-rows';
import { formatReport } from '@/server/ops/data-verify';
import {
  formatImportResult,
  importProcurement,
  NON_EMPTY_TARGET_MESSAGE,
  targetCounts,
} from '@/server/procurement/transfer/load';
import {
  readCsvSource,
  readDbSourceWith,
  type SourceClient,
} from '@/server/procurement/transfer/source';
import {
  PROCUREMENT_TABLE_NAMES,
  PROCUREMENT_TABLES,
  type SourceData,
} from '@/server/procurement/transfer/tables';
import { verifyProcurement } from '@/server/procurement/transfer/verify';

import { createTestDb } from '../../helpers/pglite';

/**
 * 조달이 통합 DB-3 — 합성 CSV → 이관 → 검증 (PGlite). 실데이터는 쓰지 않는다.
 * 전부 일치·비어 있지 않은 대상 거부·--replace·--dry-run(쓰지 않음)·setval·형식(BOM·bool·배열·NULL)·변조 탐지·금액 숨김.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/procurement');
const fixture = () => readCsvSource(FIXTURES);

const handles: DbHandle[] = [];
async function freshDb(): Promise<DbHandle> {
  const handle = await createTestDb();
  handles.push(handle);
  return handle;
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

const load = (handle: DbHandle, data: SourceData, options = { replace: false, dryRun: false }) =>
  withTransaction(
    (tx) => importProcurement(tx, data, options),
    handle,
    options.dryRun ? { accessMode: 'read only' } : undefined,
  );

const verify = (handle: DbHandle, source?: SourceData, showAmounts = false) =>
  withTransaction((tx) => verifyProcurement(tx, { source, showAmounts }), handle, {
    accessMode: 'read only',
  });

function clone(data: SourceData): SourceData {
  return Object.fromEntries(
    PROCUREMENT_TABLE_NAMES.map((table) => [table, data[table].map((row) => [...row])]),
  ) as SourceData;
}

const col = (table: keyof typeof PROCUREMENT_TABLES, name: string) =>
  PROCUREMENT_TABLES[table].columns.findIndex(([column]) => column === name);

const failures = (report: Awaited<ReturnType<typeof verify>>) =>
  report.checks.filter((check) => check.status === 'FAIL').map((check) => check.id);

describe('이관 → 검증 (합성 CSV)', () => {
  it('적재 후 건수·뷰·분포·연도별 금액·최대 id·시퀀스·정렬 해시가 모두 원본과 일치한다', async () => {
    const handle = await freshDb();
    const data = fixture();
    const result = await load(handle, data);
    expect(result.tables.map((row) => [row.table, row.source, row.targetAfter])).toEqual(
      PROCUREMENT_TABLE_NAMES.map((table) => [table, data[table].length, data[table].length]),
    );

    const report = await verify(handle, data);
    expect(failures(report)).toEqual([]);
    expect(report.checks.every((check) => check.status === 'PASS')).toBe(true);
    expect(report.exitCode).toBe(0);
    const byId = new Map(report.checks.map((check) => [check.id, check]));
    // 뷰: 첫 변경차수·excluded 제외(v_deliveries 5), active·기타 제외 조인(3), 0 초과 최근 단가(4)
    expect(byId.get('procurement.count.v_deliveries')?.actual).toBe('5');
    expect(byId.get('procurement.count.v_product_deliveries')?.actual).toBe('3');
    expect(byId.get('procurement.count.v_item_prices')?.actual).toBe('4');
    expect(byId.get('procurement.items.status_product')?.actual).toBe(
      'active / D.AMO 1 / active / WAPPLES 1 / active / iSIGN 1 / excluded / WAPPLES 1 / pending / 기타 1',
    );
    expect([...byId.keys()].filter((id) => id.startsWith('procurement.sum.deliveries.'))).toEqual([
      'procurement.sum.deliveries.2023',
      'procurement.sum.deliveries.2024',
      'procurement.sum.deliveries.날짜 없음',
    ]);
  });

  it('형식: BOM 첫 열·bool·배열·JSON 배열·NULL·jsonb·numeric 이 타입대로 들어가고 items 트리거 값은 원본 그대로', async () => {
    const handle = await freshDb();
    await load(handle, fixture());
    const [notice] = await queryRows<{
      products: string[];
      keywords: string[];
      fit_reasons: string[];
      fit_score: number;
      raw: unknown;
    }>(handle.db, sql`select * from procurement.bid_notices where bid_no = 'B-0001'`);
    expect(notice?.products).toEqual(['WAPPLES', 'D.AMO']);
    expect(notice?.keywords).toEqual(['웹방화벽']);
    expect(notice?.fit_reasons).toEqual(['+ 키워드 일치', '- 지역 제한']);
    expect(notice?.fit_score).toBe(90);
    expect(notice?.raw).toEqual({ k: 1 });
    const [second] = await queryRows<{
      products: string[];
      fit_grade: string | null;
      posted_at: unknown;
    }>(
      handle.db,
      sql`select products, fit_grade, posted_at from procurement.bid_notices where bid_no = 'B-0002'`,
    );
    expect(second).toEqual({ products: ['iSIGN'], fit_grade: null, posted_at: null });

    const items = await queryRows<{
      id: number;
      reviewed: boolean;
      updated_at: string;
      product_group: string | null;
    }>(
      handle.db,
      sql`select id::int as id, reviewed, updated_at::text as updated_at, product_group from procurement.items order by id`,
    );
    expect(items.map((row) => row.reviewed)).toEqual([true, true, true, false, true]);
    // 트리거(updated_at = now())를 끄고 적재 — 원본 시각 보존. iSIGN product_group 도 원본 값
    expect(items.every((row) => row.updated_at.startsWith('202'))).toBe(true);
    expect(
      await queryCount(
        handle.db,
        sql`select count(*)::int as n from procurement.items where updated_at > now() - interval '1 day'`,
      ),
    ).toBe(0);
    expect(items[2]?.product_group).toBe('SSO');

    const [delivery] = await queryRows<{
      quantity: string;
      excluded: boolean;
      business_name: string;
    }>(
      handle.db,
      sql`select quantity::text as quantity, excluded, business_name from procurement.deliveries where id = 3`,
    );
    expect(delivery).toEqual({
      quantity: '1.50',
      excluded: false,
      business_name: '가상 암호화\n2단계 사업',
    });

    // 적재 뒤 트리거는 다시 켜져 있다 — 새 iSIGN 행은 product_group 계산
    const [added] = await queryRows<{ id: number; product_group: string }>(
      handle.db,
      sql`insert into procurement.items (item_id, product, detail_category) values ('90009999', 'iSIGN', 'OTP')
          returning id::int as id, product_group`,
    );
    expect(added).toEqual({ id: 10, product_group: 'PASS' });
  });

  it('setval: 시퀀스가 max(id) — 다음 nextval 은 max+1, 빈 표는 1', async () => {
    const handle = await freshDb();
    const data = fixture();
    data.job_runs = [];
    await load(handle, data);
    const next = async (table: string) =>
      queryCount(
        handle.db,
        sql`select nextval(pg_get_serial_sequence(${`procurement.${table}`}, 'id'))::int as n`,
      );
    expect(await next('items')).toBe(10);
    expect(await next('item_changes')).toBe(5);
    expect(await next('deliveries')).toBe(11);
    expect(await next('delivery_changes')).toBe(3);
    expect(await next('bid_keywords')).toBe(6);
    expect(await next('job_runs')).toBe(1);
  });

  it('대상이 비어 있지 않으면 거부하고 아무것도 바꾸지 않는다', async () => {
    const handle = await freshDb();
    const data = fixture();
    await load(handle, data);
    await expect(load(handle, data)).rejects.toThrowError(NON_EMPTY_TARGET_MESSAGE);
    const counts = await targetCounts(handle.db);
    expect(counts.items).toBe(5);
    expect(failures(await verify(handle, data))).toEqual([]);
  });

  it('--replace: 비우고(RESTART IDENTITY) 다시 적재 — 대상에만 있던 행은 사라지고 검증 전부 일치', async () => {
    const handle = await freshDb();
    const data = fixture();
    await load(handle, data);
    await handle.db.execute(
      sql`insert into procurement.bid_keywords (product, keyword) values ('D.AMO', '대상에만 있는 키워드')`,
    );
    await handle.db.execute(
      sql`update procurement.deliveries set amount = amount + 1 where id = 1`,
    );
    expect(failures(await verify(handle, data)).length).toBeGreaterThan(0);

    const result = await load(handle, data, { replace: true, dryRun: false });
    expect(result.replaced).toBe(true);
    expect(formatImportResult(result)).toContain('--replace');
    expect(failures(await verify(handle, data))).toEqual([]);
  });

  it('--dry-run: 건수만 보고 쓰지 않는다 (READ ONLY), 비어 있지 않으면 적재 불가로 표시', async () => {
    const handle = await freshDb();
    const data = fixture();
    const dry = await load(handle, data, { replace: false, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.blocked).toBe(false);
    expect(dry.tables.find((row) => row.table === 'deliveries')).toEqual({
      table: 'deliveries',
      source: 7,
      targetBefore: 0,
      targetAfter: null,
    });
    expect(Object.values(await targetCounts(handle.db)).every((n) => n === 0)).toBe(true);
    expect(formatImportResult(dry)).toContain('적재 가능');

    await load(handle, data);
    const blocked = await load(handle, data, { replace: false, dryRun: true });
    expect(blocked.blocked).toBe(true);
    expect(formatImportResult(blocked)).toContain(NON_EMPTY_TARGET_MESSAGE);
  });

  it('--dry-run 은 형식 오류를 쓰기 전에 잡는다 (값은 메시지에 없음)', async () => {
    const handle = await freshDb();
    const data = clone(fixture());
    data.deliveries[0]![col('deliveries', 'dlvr_req_date')] = 'SECRET-DATE';
    const error = await load(handle, data, { replace: false, dryRun: true }).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error?.message).toBe('deliveries: 원본 값을 대상 타입으로 변환할 수 없습니다');
  });
});

describe('검증 — 변조 탐지·금액 숨김', () => {
  it('원본 한 행의 금액을 바꾸면 해시·연도별 금액이 불일치(FAIL), 금액 숫자는 기본 출력에 없다', async () => {
    const handle = await freshDb();
    const data = fixture();
    await load(handle, data);
    const altered = clone(data);
    altered.deliveries[0]![col('deliveries', 'amount')] = '2000001';

    const report = await verify(handle, altered);
    expect(report.exitCode).toBe(1);
    // id 1 은 첫 변경차수라 v_product_deliveries(2023 WAPPLES) 합계도 달라진다
    expect(failures(report)).toEqual([
      'procurement.sum.deliveries.2023',
      'procurement.sum.product.2023 WAPPLES',
      'procurement.hash.deliveries',
    ]);
    const text = formatReport(report);
    expect(text).toContain('금액 불일치');
    expect(text).not.toMatch(/\d{6,}/); // 합계·단가 같은 큰 수 없음
  });

  it('값이 아닌 행 구성이 달라도(누락·추가) 건수·최대 id·해시로 잡는다', async () => {
    const handle = await freshDb();
    const data = fixture();
    await load(handle, data);
    const fewer = clone(data);
    fewer.bid_keywords.pop();
    const ids = failures(await verify(handle, fewer));
    expect(ids).toContain('procurement.count.bid_keywords');
    expect(ids).toContain('procurement.maxid.bid_keywords');
    expect(ids).toContain('procurement.hash.bid_keywords');
  });

  it('--show-amounts 일 때만 금액 숫자를 보인다', async () => {
    const handle = await freshDb();
    const data = fixture();
    await load(handle, data);
    const text = formatReport(await verify(handle, data, true));
    // deliveries 2023: 2,000,000 + 3,000,000 + 1,500,000 / 2,000,000 + 3,000,000 + 1,650,000
    expect(text).toContain('3건 · amount 6500000 · total_amount 6650000');
  });

  it('원본 없이 돌리면 실측(MEASURED)·해시 SKIP·시퀀스 규칙만, 금액은 숨김', async () => {
    const handle = await freshDb();
    await load(handle, fixture());
    const report = await verify(handle);
    expect(report.exitCode).toBe(0);
    const statuses = new Set(report.checks.map((check) => check.status));
    expect([...statuses].sort()).toEqual(['MEASURED', 'PASS', 'SKIP']);
    expect(
      report.checks
        .filter((c) => c.status === 'PASS')
        .every((c) => c.id.startsWith('procurement.seq.')),
    ).toBe(true);
    expect(formatReport(report)).not.toMatch(/\d{6,}/);
  });

  it('시퀀스가 max(id) 와 다르면 FAIL, 스키마가 없으면 FAIL', async () => {
    const handle = await freshDb();
    await load(handle, fixture());
    await handle.db.execute(
      sql`select setval(pg_get_serial_sequence('procurement.items', 'id'), 3)`,
    );
    expect(failures(await verify(handle))).toEqual(['procurement.seq.items']);
    await handle.db.execute(sql`drop schema procurement cascade`);
    expect(failures(await verify(handle))).toEqual(['procurement.schema']);
  });
});

describe('원본 DB 읽기 (읽기 전용 트랜잭션)', () => {
  it('원본 DB 를 텍스트로 읽은 결과가 CSV 원본과 같은 검증 결과를 낸다', async () => {
    const source = await freshDb();
    await load(source, fixture());
    const client = (source.db as unknown as { $client: import('@electric-sql/pglite').PGlite })
      .$client;
    const statements: string[] = [];
    const adapter: SourceClient = {
      query: async ({ text, rowMode }) => {
        statements.push(text.split(' ')[0]!);
        const result = await client.query<string[]>(text, [], { rowMode });
        return { rows: result.rows };
      },
    };
    const fromDb = await readDbSourceWith(adapter, 'procurement');
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements.slice(1, -1).every((verb) => verb === 'SELECT')).toBe(true);

    const target = await freshDb();
    await load(target, fromDb);
    expect(failures(await verify(target, fromDb))).toEqual([]);
    expect(failures(await verify(target, fixture()))).toEqual([]);
  });
});

describe('CLI 가드', () => {
  it('원격 대상은 --target-host 없이 DB 연결 전에 거부한다', () => {
    const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(DB_DRIVER|DATABASE_URL|PGLITE_DATA_DIR|PROCUREMENT_SOURCE_URL)$/.test(key),
      ),
    );
    const result = spawnSync(
      process.execPath,
      [
        TSX_CLI,
        '--conditions=react-server',
        path.join('scripts', 'procurement-import.ts'),
        '--csv',
        FIXTURES,
      ],
      {
        cwd: ROOT,
        env: {
          ...env,
          DB_DRIVER: 'pg',
          DATABASE_URL: 'postgres://u:pw@example-remote-host:5432/prami',
        } as unknown as NodeJS.ProcessEnv,
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('--target-host');
  });
});
