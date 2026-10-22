// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, costItemLinks, importBatches, items, materialCosts } from '@/db/schema';
import { AppError } from '@/lib/result';
import { costAccessForTests } from '@/server/cost/access-token';
import {
  applyCostLinkImport,
  AUDIT_COST_LINK_IMPORT,
  COST_LINK_IMPORT_STALE_MESSAGE,
  previewCostLinkImport,
} from '@/server/cost/item-link-import';

import { TEST_META } from '../../helpers/imports';
import { auditByAction, createTestDb } from '../../helpers/pglite';

/**
 * 품목-원가 매칭 파일 미리보기·확정 (erp-upload-guide §6.2-3·5·6, 분류 규칙 cost-ratio-price-change §9) — 합성 데이터만.
 * 분류(같음·변경·추가·실패 사유별·파일에 없는 기존 링크 유지), 쓰기 없음, 확정은 변경·추가만 + 요약 감사(건수만),
 * 미리보기 이후 변경 → CONFLICT, 500건 초과 거부, 로그에 품목코드·자재번호 없음.
 */
let handle: DbHandle;
const write = costAccessForTests({ id: null, email: 'vitest' }, 'write');
const read = costAccessForTests({ id: null, email: 'vitest' }, 'read');
const ctx = () => ({ handle, access: write, meta: TEST_META });

const WAPPLES = ['WAPPLES', 'H/W Appliance', 'Wapples', '본품'] as const;
const KMS = ['D.AMO', "D'Amo KMS", 'SG-KMS', '본품'] as const;
const ISIGN = ['iSIGN', 'iSIGN+ SS', 'SS-ATH', '본품'] as const;
const PARTS = ['WAPPLES', 'Parts', 'NIC', '파츠'] as const;

type ItemKind = '본품' | '파츠';
const ITEMS: [string, readonly [string, string, string, ItemKind]][] = [
  ['TEST-ITEM-001', WAPPLES], // 같음
  ['TEST-ITEM-002', WAPPLES], // 변경
  ['TEST-ITEM-003', KMS], // 추가
  ['TEST-ITEM-004', PARTS], // 후보 범위 밖
  ['TEST-ITEM-005', WAPPLES], // 원가표에 없는 품번
  ['TEST-ITEM-006', WAPPLES], // 품번 2개
  ['TEST-ITEM-007', ISIGN], // 파일에 없는 기존 링크(유지)
];
const MATERIALS = ['TEST-MAT-001', 'TEST-MAT-002', 'TEST-MAT-003'];

const PAIRS = [
  { itemCode: 'TEST-ITEM-001', materialCode: 'TEST-MAT-001' },
  { itemCode: 'TEST-ITEM-001', materialCode: 'TEST-MAT-001' }, // 같은 쌍 중복 행
  { itemCode: 'TEST-ITEM-002', materialCode: 'TEST-MAT-002' },
  { itemCode: 'TEST-ITEM-003', materialCode: 'TEST-MAT-003' },
  { itemCode: 'TEST-ITEM-004', materialCode: 'TEST-MAT-001' },
  { itemCode: 'TEST-ITEM-005', materialCode: 'TEST-MAT-404' },
  { itemCode: 'TEST-ITEM-006', materialCode: 'TEST-MAT-001' },
  { itemCode: 'TEST-ITEM-006', materialCode: 'TEST-MAT-002' },
  { itemCode: 'TEST-ITEM-404', materialCode: 'TEST-MAT-001' },
  { itemCode: 'X'.repeat(101), materialCode: 'TEST-MAT-001' },
];

const links = () => handle.db.select().from(costItemLinks).orderBy(costItemLinks.itemCode);
const linkPairs = async () => (await links()).map((row) => [row.itemCode, row.materialCode]);

async function resetLinks() {
  await handle.db.delete(costItemLinks);
  await handle.db.insert(costItemLinks).values([
    { itemCode: 'TEST-ITEM-001', materialCode: 'TEST-MAT-001' },
    { itemCode: 'TEST-ITEM-002', materialCode: 'TEST-MAT-001' },
    { itemCode: 'TEST-ITEM-007', materialCode: 'TEST-MAT-001' },
    // 품목 마스터에 없는 링크(고아) — 파일에 없으므로 유지, 제품군 없음
    { itemCode: 'TEST-ITEM-GONE', materialCode: 'TEST-MAT-001' },
  ]);
}

let batchId: string;

beforeAll(async () => {
  handle = await createTestDb();
  const [batch] = await handle.db
    .insert(importBatches)
    .values({ kind: 'item_master', fileName: 'synthetic.xlsx', fileSha256: 'syn', fileSize: 1 })
    .returning({ id: importBatches.id });
  batchId = batch!.id;
  await handle.db.insert(items).values(
    ITEMS.map(([itemCode, [categoryMajor, categoryMid, categoryMinor, itemKind]]) => ({
      itemCode,
      itemName: `TEST ${itemCode}`,
      categoryMajor,
      categoryMid,
      categoryMinor,
      itemKind,
      itemStatus: '사용' as const,
      itemStatusRaw: '사용',
      importBatchId: batchId,
    })),
  );
  await handle.db.insert(materialCosts).values(
    MATERIALS.map((materialCode, i) => ({
      materialCode,
      materialName: `TEST 자재 ${i + 1}`,
      unit: 'EA',
      priceType: '표준구매원가',
      priceCategory: '일반',
      currency: 'KRW',
      unitCost: '1.00',
      effectiveFrom: '2026-01-01',
      isFinalSource: true,
      appliesToAllCustomers: true,
      source: 'erp' as const,
      sourceRow: i + 1,
    })),
  );
});

beforeEach(async () => {
  await resetLinks();
});

afterAll(async () => {
  await handle.close();
});

describe('previewCostLinkImport', () => {
  it('§9 분류: 같음·변경·추가·실패(사유별)·파일에 없는 기존 링크(제품군별, 유지)', async () => {
    const preview = await previewCostLinkImport(write, handle.db, { pairs: PAIRS });
    expect(preview).toMatchObject({ pairs: 9, items: 8, same: 1 });
    expect(preview.changed).toEqual([
      {
        itemCode: 'TEST-ITEM-002',
        itemName: 'TEST TEST-ITEM-002',
        family: 'WAPPLES',
        before: { materialCode: 'TEST-MAT-001', materialName: 'TEST 자재 1' },
        after: { materialCode: 'TEST-MAT-002', materialName: 'TEST 자재 2' },
      },
    ]);
    expect(preview.added).toEqual([
      {
        itemCode: 'TEST-ITEM-003',
        itemName: 'TEST TEST-ITEM-003',
        family: 'D.AMO KMS',
        before: null,
        after: { materialCode: 'TEST-MAT-003', materialName: 'TEST 자재 3' },
      },
    ]);
    expect(preview.failed.map((f) => [f.itemCode.slice(0, 13), f.reason])).toEqual([
      ['TEST-ITEM-004', 'out-of-scope'],
      ['TEST-ITEM-005', 'no-cost'],
      ['TEST-ITEM-006', 'multiple'],
      ['TEST-ITEM-404', 'no-item'],
      ['XXXXXXXXXXXXX', 'format'],
    ]);
    expect(preview.failed.find((f) => f.reason === 'multiple')?.materialCodes).toEqual([
      'TEST-MAT-001',
      'TEST-MAT-002',
    ]);
    expect(preview.failedByReason).toEqual({
      'no-item': 1,
      'out-of-scope': 1,
      'no-cost': 1,
      multiple: 1,
      format: 1,
    });
    expect(preview.kept).toEqual([
      { family: 'iSIGN', count: 1 },
      { family: null, count: 1 },
    ]);
  });

  it('쓰기 없음: 링크·감사 그대로. 원가 금액 키 없음', async () => {
    const before = await links();
    const audits = await handle.db.$count(auditLogs);
    const preview = await previewCostLinkImport(write, handle.db, { pairs: PAIRS });
    expect(await links()).toEqual(before);
    expect(await handle.db.$count(auditLogs)).toBe(audits);
    expect(JSON.stringify(preview)).not.toMatch(/unit_?cost|unitCost/i);
  });

  it('read 범위 토큰은 거부, 쌍 0개·5,000개 초과는 VALIDATION(ZodError)', async () => {
    await expect(previewCostLinkImport(read, handle.db, { pairs: PAIRS })).rejects.toThrow(
      /write 범위/,
    );
    await expect(previewCostLinkImport(write, handle.db, { pairs: [] })).rejects.toThrow();
    const many = Array.from({ length: 5001 }, (_, i) => ({
      itemCode: `TEST-ITEM-${i}`,
      materialCode: 'TEST-MAT-001',
    }));
    await expect(previewCostLinkImport(write, handle.db, { pairs: many })).rejects.toThrow();
  });
});

describe('applyCostLinkImport', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('변경·추가만 저장(행별 감사 2) + 요약 감사 1건(건수만). 파일에 없는 링크·실패 행은 그대로', async () => {
    const upserts = (await auditByAction(handle, 'cost_link.upsert')).length;
    const result = await applyCostLinkImport(ctx(), {
      pairs: PAIRS,
      expected: { changed: 1, added: 1 },
    });
    expect(result).toEqual({
      saved: 2,
      unchanged: 1,
      failedByReason: { 'no-item': 1, 'out-of-scope': 1, 'no-cost': 1, multiple: 1, format: 1 },
    });
    expect(await linkPairs()).toEqual([
      ['TEST-ITEM-001', 'TEST-MAT-001'],
      ['TEST-ITEM-002', 'TEST-MAT-002'],
      ['TEST-ITEM-003', 'TEST-MAT-003'],
      ['TEST-ITEM-007', 'TEST-MAT-001'],
      ['TEST-ITEM-GONE', 'TEST-MAT-001'],
    ]);
    expect(await auditByAction(handle, 'cost_link.upsert')).toHaveLength(upserts + 2);
    const summary = (await auditByAction(handle, AUDIT_COST_LINK_IMPORT)).at(-1)!;
    expect(summary.after).toEqual(result);
    // 요약 감사 어디에도 품목코드·자재번호·파일명이 없다
    expect(JSON.stringify(summary)).not.toMatch(/TEST-ITEM|TEST-MAT|xlsx/);
    expect(logs.join('\n')).not.toMatch(/TEST-ITEM|TEST-MAT/);
  });

  it('미리보기 이후 바뀜(건수 불일치) → CONFLICT stale, 저장·감사 없음, 로그는 건수만', async () => {
    const before = await links();
    const audits = await handle.db.$count(auditLogs);
    // 미리보기 뒤 다른 관리자가 TEST-ITEM-002 를 이미 같은 자재로 바꿈 → 변경 0
    await handle.db
      .update(costItemLinks)
      .set({ materialCode: 'TEST-MAT-002' })
      .where(eq(costItemLinks.itemCode, 'TEST-ITEM-002'));
    const error = await applyCostLinkImport(ctx(), {
      pairs: PAIRS,
      expected: { changed: 1, added: 1 },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: COST_LINK_IMPORT_STALE_MESSAGE,
      details: { stale: true },
    });
    expect(await handle.db.$count(auditLogs)).toBe(audits);
    expect((await links()).length).toBe(before.length);
    expect(logs.join('\n')).not.toMatch(/TEST-ITEM|TEST-MAT/);
    expect(logs.join('\n')).toMatch(/cost_link\.import\.stale/);
  });

  it('변경·추가가 0건이면 VALIDATION', async () => {
    await expect(
      applyCostLinkImport(ctx(), {
        pairs: [{ itemCode: 'TEST-ITEM-001', materialCode: 'TEST-MAT-001' }],
        expected: { changed: 0, added: 0 },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('변경·추가 500건 초과 → 거부(저장 없음)', async () => {
    const extra = Array.from({ length: 501 }, (_, i) => `TEST-ITEM-B${String(i).padStart(3, '0')}`);
    await handle.db.insert(items).values(
      extra.map((itemCode) => ({
        itemCode,
        itemName: `TEST ${itemCode}`,
        categoryMajor: WAPPLES[0],
        categoryMid: WAPPLES[1],
        categoryMinor: WAPPLES[2],
        itemKind: WAPPLES[3],
        itemStatus: '사용' as const,
        itemStatusRaw: '사용',
        importBatchId: batchId,
      })),
    );
    const before = await links();
    await expect(
      applyCostLinkImport(ctx(), {
        pairs: extra.map((itemCode) => ({ itemCode, materialCode: 'TEST-MAT-001' })),
        expected: { changed: 0, added: 501 },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('500건') });
    expect(await links()).toEqual(before);
  });

  it('read 범위 토큰은 거부', async () => {
    await expect(
      applyCostLinkImport(
        { ...ctx(), access: read },
        { pairs: PAIRS, expected: { changed: 1, added: 1 } },
      ),
    ).rejects.toThrow(/write 범위/);
  });
});
