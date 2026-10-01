// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { queryRows } from '@/server/imports/sql-rows';

/**
 * AC-315 이관: 0004 까지 적용된 DB(포맷 확정 전 stub·최소 계약 행)에 0005_items_master 를 적용하면
 * raw.stub=true 와 종류·상태·대분류가 빈 행은 source='stub', 완전한 행은 master 로 백필되고, 이후 CHECK 가 master 행을 강제한다.
 * 추가형(expand)이라 기존 컬럼 값은 그대로다.
 */
const DRIZZLE = path.resolve(process.cwd(), 'drizzle');
let handle: DbHandle;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'prami-0004-'));
  cpSync(DRIZZLE, tmp, { recursive: true });
  const journalPath = path.join(tmp, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((entry) => entry.idx < 5);
  writeFileSync(journalPath, JSON.stringify(journal));
  handle = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
  await migrateDb(handle, { migrationsFolder: tmp });
  const [batch] = await queryRows<{ id: string }>(
    handle.db,
    sql`insert into import_batches (kind, file_name, file_sha256, file_size)
        values ('sales_price', 'sales.xlsx', 'sha-0004', 1) returning id`,
  );
  await handle.db.execute(sql`
    insert into items (item_code, item_name, raw, import_batch_id) values
      ('PSTUB1', '판매단가에만 있던 품번', '{"stub": true}'::jsonb, ${batch!.id}),
      ('PLEGACY1', '최소 계약 행', '{"비고": "x"}'::jsonb, ${batch!.id})`);
  await handle.db.execute(sql`
    insert into items (item_code, item_name, category_major, item_status, item_kind, raw, import_batch_id)
    values ('PFULL1', '완전한 행', 'WAPPLES', '사용', '본품', '{}'::jsonb, ${batch!.id})`);
}, 120_000);

afterAll(async () => {
  await handle?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('0005_items_master 이관 (AC-315)', () => {
  it('백필: stub·빈 행 → stub, 완전한 행 → master, 기존 값 보존', async () => {
    // 0005 자체를 검증한다 — 0006(구 앱 쓰기 호환 트리거)은 migration-0006.test.ts
    const journalPath = path.join(tmp, 'meta', '_journal.json');
    const journal = JSON.parse(
      readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8'),
    ) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 5);
    writeFileSync(journalPath, JSON.stringify(journal));
    await migrateDb(handle, { migrationsFolder: tmp });
    const rows = await queryRows<{ item_code: string; source: string; item_name: string }>(
      handle.db,
      sql`select item_code, source::text as source, item_name from items order by item_code`,
    );
    expect(rows).toEqual([
      { item_code: 'PFULL1', source: 'master', item_name: '완전한 행' },
      { item_code: 'PLEGACY1', source: 'stub', item_name: '최소 계약 행' },
      { item_code: 'PSTUB1', source: 'stub', item_name: '판매단가에만 있던 품번' },
    ]);
  });

  it('CHECK: master 행은 종류·상태·대분류가 있어야 한다 / 추가 컬럼은 NULL 허용(expand)', async () => {
    await expect(
      handle.db.execute(sql`update items set source = 'master' where item_code = 'PSTUB1'`),
    ).rejects.toThrow();
    const [columns] = await queryRows<{ n: number }>(
      handle.db,
      sql`select count(*)::int as n from information_schema.columns
          where table_name = 'items' and is_nullable = 'YES'
            and column_name in ('category_major_raw', 'base_unit', 'erp_registered_on', 'erp_modified_on', 'item_kind_rule')`,
    );
    expect(columns!.n).toBe(5);
  });
});
