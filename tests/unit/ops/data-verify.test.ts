// @vitest-environment node
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { withTransaction, type Tx } from '@/db/tx';
import { costAccessForTests } from '@/server/cost/access-token';
import { applyCostImport } from '@/server/cost/apply-costs';
import { applyPolicy } from '@/server/imports/apply-policy';
import { uploadItemFiles } from '@/server/imports/item-upload';
import { queryCount, queryRows } from '@/server/imports/sql-rows';
import { DATA_BASELINE, type DataBaseline } from '@/server/ops/data-baseline';
import { formatReport, verifyData, type VerifyOptions } from '@/server/ops/data-verify';

import {
  fixtureBytes,
  TEST_ACTOR,
  TEST_META,
  uploadFixture,
  XLSX_MIME,
} from '../../helpers/imports';
import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * PRAMI-003 §4.9.2 `data:verify` (AC-331 축소판·AC-332). 축소 픽스처(판매단가 200행 → 품목 → 원가)를 정식 서비스 경로로 적재한 DB 에서
 * ① 읽기 전용 ② 고장 주입 4종 FAIL ③ 원본 SHA 불일치 exit 2 ⑤ 출력에 이메일·품명 없음 ⑥ --fresh 없으면 업무 데이터 검사 생략.
 * 원본 전체 기대값(2,511·2,428 …)은 `pnpm data:verify --fresh`(PRAMI_INPUTS_DIR 원본, 격리 PG)로 확인 — PR 본문.
 */
let handle: DbHandle;
let baseline: DataBaseline;
const ROLLBACK = new Error('rollback');

const OPTIONS: VerifyOptions = {
  stage: 'data',
  fresh: true,
  allowPartMappings: false,
  requireAdmin: false,
  allowedDomains: ['pentasecurity.com'],
};

async function loadFixtures(db: DbHandle) {
  const ctx = { handle: db, actor: TEST_ACTOR, meta: TEST_META };
  const sales = await uploadFixture(db, 'sales', 'sales-200.xlsx');
  await applyPolicy(ctx, {
    salesBatchId: sales.batchId,
    itemBatchId: null,
    salesReused: false,
    itemReused: false,
  });
  const items = await uploadItemFiles(ctx, [
    { fileName: 'items-v1.xlsx', mimeType: XLSX_MIME, bytes: fixtureBytes('items-v1.xlsx') },
  ]);
  await applyPolicy(ctx, {
    salesBatchId: sales.batchId,
    itemBatchId: items.batchId,
    salesReused: true,
    itemReused: false,
  });
  const costs = await uploadFixture(db, 'costs', 'costs-dup.xlsx');
  await applyCostImport(
    { handle: db, access: costAccessForTests({ id: null, email: 'vitest' }), meta: TEST_META },
    { batchId: costs.batchId, reused: false },
  );
  // 합성 품목 픽스처가 덮지 않는 판매단가 품번(stub)은 계열째 지운다 — "품목 전부 master" 인 클린 설치 모양으로 맞춘다
  await db.db.execute(
    sql`delete from sales_prices where item_code in (select item_code from items where source = 'stub')`,
  );
  await db.db.execute(sql`delete from items where source = 'stub'`);
}

/** 축소 픽스처 DB 의 실측으로 기준값을 만든다 (해시는 적용 배치 그대로) */
async function measuredBaseline(db: DbHandle): Promise<DataBaseline> {
  const count = (query: SQL) => queryCount(db.db, query);
  const dist = async (query: SQL) =>
    Object.fromEntries(
      (await queryRows<{ k: string; n: number }>(db.db, query)).map((row) => [row.k, row.n]),
    );
  const [sales] = await queryRows<{ sha: string }>(
    db.db,
    sql`select file_sha256 as sha from import_batches where kind = 'sales_price' and status = 'applied'`,
  );
  const [costs] = await queryRows<{ sha: string }>(
    db.db,
    sql`select file_sha256 as sha from import_batches where kind = 'material_cost' and status = 'applied'`,
  );
  const files = await queryRows<{ sha: string }>(
    db.db,
    sql`select f->>'sha256' as sha from import_batches, jsonb_array_elements(source_files) f
        where kind = 'item_master' and status = 'applied'`,
  );
  return {
    sources: { sales: sales!.sha, costs: costs!.sha, items: files.map((row) => row.sha) },
    expected: {
      migrations: 11,
      items: await count(sql`select count(*)::int as n from items`),
      itemStatus: await dist(
        sql`select item_status::text as k, count(*)::int as n from items group by 1`,
      ),
      itemMajor: await dist(
        sql`select category_major as k, count(*)::int as n from items group by 1`,
      ),
      itemKind: await dist(
        sql`select item_kind::text as k, count(*)::int as n from items group by 1`,
      ),
      salesRows: await count(
        sql`select count(*)::int as n from sales_prices where deleted_at is null`,
      ),
      salesSeries: await count(sql`select count(distinct series_key)::int as n from sales_prices`),
      salesLatest: await count(
        sql`select count(*)::int as n from sales_prices where is_latest_in_series`,
      ),
      operating: await count(
        sql`select count(*)::int as n from sales_prices where operation_status = '운영중'`,
      ),
      unused: await count(
        sql`select count(*)::int as n from sales_prices where operation_status = '미사용'`,
      ),
      costRows: await count(sql.raw('select count(*)::int as n from material_costs')),
    },
  };
}

/** 고장을 주입하고 검증한 뒤 되돌린다 (같은 트랜잭션에서 검증 → 롤백) */
async function withInjected(inject: (tx: Tx) => Promise<void>) {
  let result: Awaited<ReturnType<typeof verifyData>> | undefined;
  await withTransaction(async (tx) => {
    await inject(tx);
    result = await verifyData(tx, { ...OPTIONS, baseline });
    throw ROLLBACK;
  }, handle).catch((error: unknown) => {
    if (error !== ROLLBACK) throw error;
  });
  return result!;
}

const statusOf = (report: Awaited<ReturnType<typeof verifyData>>, id: string) =>
  report.checks.find((check) => check.id === id)?.status;

beforeAll(async () => {
  handle = await createTestDb();
  await loadFixtures(handle);
  baseline = await measuredBaseline(handle);
});

afterAll(async () => {
  await handle.close();
});

describe('data:verify 통과·출력 (AC-331 축소판·AC-332 ⑤⑥)', () => {
  it('정식 경로로 적재한 클린 DB → exit 0, 로그인 전이라 ADMIN 검사는 SKIP', async () => {
    const report = await withTransaction((tx) => verifyData(tx, { ...OPTIONS, baseline }), handle, {
      accessMode: 'read only',
    });
    expect(report.checks.filter((check) => check.status === 'FAIL')).toEqual([]);
    expect(report.exitCode).toBe(0);
    expect(statusOf(report, 'fresh.admin')).toBe('SKIP');
  });

  it('원격 대상(requireAdmin)은 사용자 0명이면 ADMIN 검사 FAIL', async () => {
    const report = await verifyData(handle.db, { ...OPTIONS, baseline, requireAdmin: true });
    expect(statusOf(report, 'fresh.admin')).toBe('FAIL');
    expect(report.exitCode).toBe(1);
  });

  it('출력에 이메일·품명·금액이 없다 (개수·라벨만)', async () => {
    const report = await withInjected(async (tx) => {
      await tx.execute(
        sql`insert into users (email, name, role, created_via) values ('boss@pentasecurity.com', '관리자 이름', 'ADMIN', 'bootstrap')`,
      );
    });
    const text = formatReport(report);
    expect(text).not.toMatch(/@/);
    expect(text).not.toContain('관리자 이름');
    const names = await queryRows<{ name: string }>(
      handle.db,
      sql`select item_name as name from items limit 50`,
    );
    for (const { name } of names) expect(text).not.toContain(name);
    const prices = await queryRows<{ p: string }>(
      handle.db,
      sql`select distinct unit_price::text as p from sales_prices where unit_price > 9999 limit 20`,
    );
    for (const { p } of prices) expect(text).not.toContain(p);
    expect(statusOf(report, 'fresh.admin')).toBe('PASS');
  });

  it('--fresh 없이 실행하면 업무 데이터 검사를 생략한다', async () => {
    const report = await verifyData(handle.db, { ...OPTIONS, baseline, fresh: false });
    expect(report.checks.some((check) => check.id.startsWith('fresh.'))).toBe(false);
    expect(report.exitCode).toBe(0);
  });

  it('--stage schema 는 스키마만', async () => {
    const report = await verifyData(handle.db, { ...OPTIONS, stage: 'schema' });
    expect(report.checks.map((check) => check.id)).toEqual(['schema.latest', 'schema.migrations']);
    expect(report.exitCode).toBe(0);
  });
});

describe('읽기 전용 (AC-332 ①)', () => {
  it('실행 중 쿼리에 INSERT·UPDATE·DELETE·DDL 이 없다 (쿼리 로그)', async () => {
    const dialect = new PgDialect();
    const log: string[] = [];
    await withTransaction(
      async (tx) => {
        const spy = new Proxy(tx, {
          get(target, property, receiver) {
            if (property !== 'execute') return Reflect.get(target, property, receiver);
            return (query: SQL) => {
              log.push(dialect.sqlToQuery(query).sql);
              return target.execute(query);
            };
          },
        });
        await verifyData(spy, { ...OPTIONS, baseline });
      },
      handle,
      { accessMode: 'read only' },
    );
    expect(log.length).toBeGreaterThan(20);
    expect(log.filter((text) => !/^\s*select\b/i.test(text))).toEqual([]);
    expect(
      log.filter((text) => /\b(insert|update|delete|create|alter|drop|truncate)\b/i.test(text)),
    ).toEqual([]);
  });

  it('READ ONLY 트랜잭션은 쓰기를 거부한다 (DB 가 보장)', async () => {
    await expect(
      withTransaction((tx) => tx.execute(sql`delete from notices`), handle, {
        accessMode: 'read only',
      }),
    ).rejects.toThrow();
  });
});

describe('고장 주입 → exit 1 + 해당 항목 FAIL (AC-332 ②)', () => {
  it('판매단가 1행 삭제', async () => {
    const report = await withInjected(async (tx) => {
      await tx.execute(
        sql`delete from sales_prices where id = (select id from sales_prices where not is_latest_in_series limit 1)`,
      );
    });
    expect(report.exitCode).toBe(1);
    expect(statusOf(report, 'sales.rows')).toBe('FAIL');
  });

  it('fixture 사용자 1명 추가', async () => {
    const report = await withInjected(async (tx) => {
      await tx.execute(
        sql`insert into users (email, name, role, created_via) values ('fixture-admin@pentasecurity.com', 'x', 'ADMIN', 'admin')`,
      );
    });
    expect(report.exitCode).toBe(1);
    expect(statusOf(report, 'fresh.fixture')).toBe('FAIL');
  });

  it('공지 1건 추가', async () => {
    const report = await withInjected(async (tx) => {
      await tx.execute(
        sql`insert into notices (title, body, author_name, published_at) values ('t', 'b', 'a', '2026-10-01')`,
      );
    });
    expect(report.exitCode).toBe(1);
    expect(statusOf(report, 'fresh.notices')).toBe('FAIL');
  });

  it("감사 actor_label='seed' 1행", async () => {
    const report = await withInjected(async (tx) => {
      await tx.execute(
        sql`insert into audit_logs (actor_label, action) values ('seed', 'user.seed')`,
      );
    });
    expect(report.exitCode).toBe(1);
    expect(statusOf(report, 'fresh.seed_audit')).toBe('FAIL');
  });

  it('허용 도메인 밖 사용자·part_mappings(허용 플래그 없으면)도 FAIL', async () => {
    const report = await withInjected(async (tx) => {
      await tx.execute(
        sql`insert into users (email, name, role, created_via) values ('x@gmail.com', 'x', 'USER', 'auto')`,
      );
    });
    expect(statusOf(report, 'fresh.domain')).toBe('FAIL');
  });
});

describe('원본 SHA-256 불일치 → exit 2 + 실측 (AC-332 ③)', () => {
  it('실제 원본 기준값과 축소 픽스처 배치는 해시가 달라 수치는 MEASURED, 규칙 검사는 그대로', async () => {
    const report = await verifyData(handle.db, { ...OPTIONS, baseline: DATA_BASELINE });
    expect(report.sourceChanged).toBe(true);
    expect(report.exitCode).toBe(2);
    expect(statusOf(report, 'items.total')).toBe('MEASURED');
    expect(statusOf(report, 'inv.i2')).toBe('PASS');
    expect(formatReport(report)).toMatch(/원본이 바뀌었음/);
  });

  it('해시가 달라도 규칙 위반이 있으면 exit 1 이 우선', async () => {
    const saved = baseline;
    baseline = DATA_BASELINE;
    try {
      const report = await withInjected(async (tx) => {
        await tx.execute(
          sql`insert into audit_logs (actor_label, action) values ('seed', 'user.seed')`,
        );
      });
      expect(report.exitCode).toBe(1);
    } finally {
      baseline = saved;
    }
  });
});

describe('ADMIN 이 로그인한 뒤', () => {
  it('ADMIN 1명 이상이면 PASS', async () => {
    await insertUser(handle, { email: 'first-admin@pentasecurity.com', role: 'ADMIN' });
    const report = await verifyData(handle.db, { ...OPTIONS, baseline });
    expect(statusOf(report, 'fresh.admin')).toBe('PASS');
  });
});
