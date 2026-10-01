// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { applyItemBatch } from '@/server/imports/apply-steps';
import { queryRows } from '@/server/imports/sql-rows';

import { LEGACY_EXPECTED_ROWS, runLegacyItemWrites } from '../../helpers/legacy-item-writes';

/**
 * PRAMI-003 PR-1 QA M-1 — 0006_items_legacy_write_compat: 직전 앱(da1b186·1605ad7)의 items 쓰기 3경로
 * (판매단가 stub·파츠 매핑 stub·구 품목 배치 적용)가 0005 스키마에서는 23514 로 실패하고, 0006 이후에는 stub 으로 들어간다.
 * 같은 시나리오를 실제 PostgreSQL 16 에서도 확인한다(tests/integration/items-legacy-compat.pg.test.ts).
 */
const DRIZZLE = path.resolve(process.cwd(), 'drizzle');
let upTo0005: DbHandle;
let latest: DbHandle;
let tmp: string;

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    parts.push(String((current as Error).message ?? current));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'prami-0005-'));
  cpSync(DRIZZLE, tmp, { recursive: true });
  const journalPath = path.join(tmp, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((entry) => entry.idx <= 5);
  writeFileSync(journalPath, JSON.stringify(journal));
  upTo0005 = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
  await migrateDb(upTo0005, { migrationsFolder: tmp });
  latest = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
  await migrateDb(latest);
}, 180_000);

afterAll(async () => {
  await upTo0005?.close();
  await latest?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('0006 구버전 앱 쓰기 호환 (QA M-1, P-4 expand)', () => {
  it('0005 까지만 적용된 DB: 구 앱 stub 생성이 items_master_required_ck 위반으로 실패한다 (수정 전 재현)', async () => {
    const failure = await runLegacyItemWrites(upTo0005.db, 'pre').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).not.toBeNull();
    expect(errorText(failure)).toContain('items_master_required_ck');
  });

  it('0006 적용 DB: 구 앱의 판매단가 stub·파츠 stub·구 품목 배치 적용이 모두 성공하고, 불완전한 행은 stub 이 된다', async () => {
    const rows = await runLegacyItemWrites(latest.db, 'post');
    expect(rows).toEqual(LEGACY_EXPECTED_ROWS);
  });

  it('CHECK 는 남아 있고 master 이면서 종류·상태·대분류가 빈 행은 0 이다', async () => {
    const [check] = await queryRows<{ n: number }>(
      latest.db,
      sql`select count(*)::int as n from pg_constraint where conname = 'items_master_required_ck'`,
    );
    expect(check!.n).toBe(1);
    const [violations] = await queryRows<{ n: number }>(
      latest.db,
      sql`select count(*)::int as n from items where source = 'master'
          and (item_kind is null or item_status is null or category_major is null)`,
    );
    expect(violations!.n).toBe(0);
  });

  it('신 앱 쓰기는 그대로: 완전한 값으로 master 로 되돌리면 master 가 유지된다', async () => {
    await latest.db.execute(sql`
      update items set source = 'master', item_kind = '본품', item_status = '사용', category_major = 'D.AMO'
      where item_code = 'PMASTER2'`);
    const [row] = await queryRows<{ source: string }>(
      latest.db,
      sql`select source::text as source from items where item_code = 'PMASTER2'`,
    );
    expect(row!.source).toBe('master');
  });

  it('신 앱 품목 적용이 불완전한 스테이징 행을 master 로 쓰면 트리거가 낮추고, 적용은 불변식 위반으로 실패한다 (조용한 강등 금지)', async () => {
    const [batch] = await queryRows<{ id: string }>(
      latest.db,
      sql`insert into import_batches (kind, file_name, file_sha256, file_size)
          values ('item_master', 'broken.xlsx', 'sha-broken', 1) returning id`,
    );
    await latest.db.execute(sql`
      insert into stg_items (batch_id, row_index, item_code, item_name, category_major, item_status, item_kind)
      values (${batch!.id}, 1, 'PBROKEN1', '종류 누락', 'WAPPLES', '사용', null)`);
    await expect(
      latest.db.transaction((tx) =>
        applyItemBatch(tx as never, batch!.id, batch!.id, { mode: 'merge', keptMajors: [] }),
      ),
    ).rejects.toThrow('품목 적용 불변식 위반');
    const [row] = await queryRows<{ n: number }>(
      latest.db,
      sql`select count(*)::int as n from items where item_code = 'PBROKEN1'`,
    );
    expect(row!.n).toBe(0);
  });
});
