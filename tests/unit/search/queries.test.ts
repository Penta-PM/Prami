// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { notices } from '@/db/schema';
import { costAccessForTests } from '@/server/cost/access-token';
import { applyCostImport } from '@/server/cost/apply-costs';
import { applyPolicy } from '@/server/imports/apply-policy';
import { normalizeQuery, searchAll } from '@/server/search/queries';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb } from '../../helpers/pglite';

/** 통합 검색 (§4.5.4, Q-14, AC-52): 품목(품명·품번) + 공지(제목·본문), 원가 키 없음 (AC-43) */
let handle: DbHandle;
const COST_KEYS = /unit_cost|unitCost|material_code|materialCode|material_costs/;

beforeAll(async () => {
  handle = await createTestDb();
  const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
  const costs = await uploadFixture(handle, 'costs', 'costs-sample.xlsx');
  await applyCostImport(
    { handle, access: costAccessForTests({ id: null, email: 'vitest' }), meta: TEST_META },
    { batchId: costs.batchId, reused: false },
  );
  await handle.db.insert(notices).values([
    {
      title: 'Wapples SA 라인업 가격 안내',
      body: '본문',
      authorName: '가격정책팀',
      isImportant: true,
    },
    { title: '무관한 공지', body: 'Wapples 본문에만 등장', authorName: '운영팀' },
    { title: '삭제된 공지 Wapples', body: 'x', authorName: 'x', deletedAt: new Date() },
  ]);
});

afterAll(async () => {
  await handle.close();
});

describe('normalizeQuery', () => {
  it('공백 정리·길이 제한·배열 첫 값', () => {
    expect(normalizeQuery('  Wapples   SA ')).toBe('Wapples SA');
    expect(normalizeQuery(['a', 'b'])).toBe('a');
    expect(normalizeQuery(undefined)).toBe('');
    expect(normalizeQuery('x'.repeat(200))).toHaveLength(100);
  });
});

describe('searchAll', () => {
  it('품명 부분 일치(대소문자 무시) → 품번당 1건, 공지는 제목·본문 일치·삭제 제외', async () => {
    const result = await searchAll(handle.db, 'wapples sa-500');
    expect(result.query).toBe('wapples sa-500');
    expect(result.items.map((item) => item.itemName)).toContain('Wapples SA-500');
    expect(new Set(result.items.map((item) => item.itemCode)).size).toBe(result.items.length);
    expect(result.items[0]).toMatchObject({ productFamily: 'WAPPLES', itemStatus: null });

    const wide = await searchAll(handle.db, 'Wapples');
    expect(wide.items.length).toBeGreaterThan(1);
    expect(wide.items.length).toBeLessThanOrEqual(20);
    expect(wide.notices.map((n) => n.title)).toEqual([
      'Wapples SA 라인업 가격 안내',
      '무관한 공지',
    ]);
  });

  it('품번 일치, 빈 검색어는 빈 결과, LIKE 와일드카드는 문자 그대로', async () => {
    const byCode = await searchAll(handle.db, 'P1004010009');
    expect(byCode.items).toEqual([expect.objectContaining({ itemCode: 'P1004010009' })]);
    expect(await searchAll(handle.db, '   ')).toEqual({
      query: '',
      items: [],
      notices: [],
      truncated: { items: false, notices: false },
    });
    expect((await searchAll(handle.db, '%')).items).toEqual([]);
  });

  it('그룹당 20건 상한에 걸리면 truncated 표시, 아니면 false (PR-9 QA INFO)', async () => {
    const wide = await searchAll(handle.db, 'P');
    expect(wide.items).toHaveLength(20);
    expect(wide.truncated).toEqual({ items: true, notices: false });
    const narrow = await searchAll(handle.db, 'P1004010009');
    expect(narrow.truncated).toEqual({ items: false, notices: false });
  });

  it('품명의 NBSP 는 공백으로 검색된다 (PR-9 QA INFO)', async () => {
    await handle.db.execute(
      sql`update sales_prices set item_name = replace(item_name, ' ', chr(160)) where item_code = 'P1004010009'`,
    );
    const hit = await searchAll(handle.db, 'Wapples SA-500');
    expect(hit.items.map((item) => item.itemCode)).toContain('P1004010009');
  });

  it('AC-43: 결과 JSON 에 원가 키가 없다', async () => {
    const json = JSON.stringify(await searchAll(handle.db, 'W'));
    expect(json.length).toBeGreaterThan(50);
    expect(json).not.toMatch(COST_KEYS);
  });
});
