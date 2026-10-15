// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { costItemLinks, importBatches, items, materialCosts, salesPrices } from '@/db/schema';
import { AppError } from '@/lib/result';
import { costAccessForTests } from '@/server/cost/access-token';
import { confirmCostLinks, deleteCostLink, listCostLinkView } from '@/server/cost/item-links';

import { TEST_META } from '../../helpers/imports';
import { auditByAction, createTestDb } from '../../helpers/pglite';

/**
 * 원가 매핑 조회·확정·해제 (스펙 cost-ratio-price-change §2.1, §4 매핑 화면). 후보 범위·제안·확정만 저장·
 * 일괄 확정·검증(품목·자재 존재)·변경 없음·감사·고아 링크. 응답에 원가 금액 키가 없다.
 */
let handle: DbHandle;
const write = costAccessForTests({ id: null, email: 'vitest' }, 'write');
const read = costAccessForTests({ id: null, email: 'vitest' }, 'read');
const ctx = () => ({ handle, access: write, meta: TEST_META });

const ITEMS = [
  // WAPPLES 현행·구 분류 (중분류 또는 소분류가 H/W Appliance)
  ['P1', 'Wapples-1700 T2 (H1700 T2)', 'WAPPLES', 'H/W Appliance', 'Wapples', '본품'],
  [
    'P2',
    'Wapples-2600 (H2600)-RAID (16~22port)',
    'WAPPLES',
    'Wapples Product',
    'H/W Appliance',
    '본품',
  ],
  ['P3', 'Wapples-2600 S/W 업그레이드', 'WAPPLES', 'H/W Appliance', 'Wapples', '본품'],
  // KMS: SG-KMS·SG-RST 만, SA 제외
  ['P4', 'SG-KMS-1700 T1 for Rest API', 'D.AMO', "D'Amo KMS", 'SG-RST', '본품'],
  ['P5', 'SG-KMS-SA100 (VC4)', 'D.AMO', "D'Amo KMS", 'SG-KMS SA', '본품'],
  // iSIGN: SS-ATH 포함, SS-ATH SA 제외
  ['P6', 'SS-ATH-1700 T2', 'iSIGN', 'iSIGN+ SS', 'SS-ATH', '본품'],
  ['P7', 'SS-ATH-SA100 (VC4)', 'iSIGN', 'iSIGN+ SS', 'SS-ATH SA', '본품'],
  // 후보 밖: 파츠·다른 분류
  ['P8', 'NIC 10G', 'WAPPLES', 'Parts', 'NIC', '파츠'],
  ['P9', 'Cloudbric Enterprise', 'WAPPLES', 'Cloudbric SECaaS', 'Enterprise', '본품'],
] as const;

const COSTS = [
  ['W1700T2', 'WAPPLES-1700 T2', '표준구매원가', '2026-01-01'],
  ['W2600R', 'WAPPLES-2600 RAID', '표준구매원가', '2026-01-01'],
  ['WKMS1700', 'SG-KMS 1700 T1', '표준구매원가', '2026-01-01'],
  ['WISIGN1700', 'iSIGN+ 1700 T2', '표준구매원가', '2026-01-01'],
  // 같은 자재번호의 최근 행 이름을 쓴다
  ['WISIGN1700', 'iSIGN+ 1700 T2 (개정)', '표준구매원가', '2026-07-01'],
  // 다른 단가유형은 목록·검증 대상이 아니다
  ['WOTHER', 'WAPPLES-9999', '기타원가', '2026-01-01'],
] as const;

beforeAll(async () => {
  handle = await createTestDb();
  const [batch] = await handle.db
    .insert(importBatches)
    .values({ kind: 'item_master', fileName: 'links.xlsx', fileSha256: 'links', fileSize: 1 })
    .returning({ id: importBatches.id });
  await handle.db.insert(items).values(
    ITEMS.map(([itemCode, itemName, categoryMajor, categoryMid, categoryMinor, itemKind]) => ({
      itemCode,
      itemName,
      categoryMajor,
      categoryMid,
      categoryMinor,
      itemKind,
      itemStatus: '사용' as const,
      itemStatusRaw: '사용',
      importBatchId: batch!.id,
    })),
  );
  await handle.db.insert(materialCosts).values(
    COSTS.map(([materialCode, materialName, priceType, effectiveFrom], i) => ({
      materialCode,
      materialName,
      unit: 'EA',
      priceType,
      priceCategory: '일반',
      currency: 'KRW',
      unitCost: '1000000.00',
      effectiveFrom,
      isFinalSource: true,
      appliesToAllCustomers: true,
      source: 'erp' as const,
      sourceRow: i + 1,
    })),
  );
  // 정상판매 가격은 P1 만
  await handle.db.insert(salesPrices).values({
    sourceId: 1,
    productFamily: 'WAPPLES',
    itemCode: 'P1',
    itemName: 'Wapples-1700 T2 (H1700 T2)',
    unit: 'EA',
    priceType: '정상판매',
    priceCategory: '일반',
    currency: 'KRW',
    hasCorePrice: false,
    unitPrice: '10500000.00',
    effectiveFrom: '2026-05-01',
    appliesToAllCustomers: true,
    isFinalSource: true,
    baseCoreCount: 0,
    unitPricePerCore: '0.00',
    customerCode: '0',
    source: 'erp',
  });
});

afterAll(async () => {
  await handle.close();
});

describe('listCostLinkView', () => {
  it('후보 범위: WAPPLES H/W(현행·구 분류)·KMS SG-KMS/SG-RST·iSIGN SS-ATH 등, SA·파츠·다른 분류 제외', async () => {
    const view = await listCostLinkView(read, handle.db);
    expect(view.candidates.map((c) => [c.itemCode, c.family]).sort()).toEqual([
      ['P1', 'WAPPLES'],
      ['P2', 'WAPPLES'],
      ['P3', 'WAPPLES'],
      ['P4', 'D.AMO KMS'],
      ['P6', 'iSIGN'],
    ]);
    // 제품군 순(D.AMO KMS → WAPPLES → iSIGN, 이름 순은 DB 콜레이션을 따른다)
    expect([...new Set(view.candidates.map((c) => c.family))]).toEqual([
      'D.AMO KMS',
      'WAPPLES',
      'iSIGN',
    ]);
  });

  it('제안(저장 안 함)·이유·정상판매 여부, 원가 금액 키 없음', async () => {
    const view = await listCostLinkView(read, handle.db);
    const byCode = new Map(view.candidates.map((c) => [c.itemCode, c]));
    expect(byCode.get('P1')).toMatchObject({
      hasNormalPrice: true,
      link: null,
      suggestion: { materialCode: 'W1700T2', materialName: 'WAPPLES-1700 T2' },
      noSuggestion: null,
    });
    expect(byCode.get('P2')?.suggestion?.materialCode).toBe('W2600R');
    expect(byCode.get('P3')).toMatchObject({ suggestion: null, noSuggestion: 'sw-upgrade' });
    expect(byCode.get('P4')?.suggestion?.materialCode).toBe('WKMS1700');
    expect(byCode.get('P6')?.suggestion).toEqual({
      materialCode: 'WISIGN1700',
      materialName: 'iSIGN+ 1700 T2 (개정)',
    });
    expect(byCode.get('P2')?.hasNormalPrice).toBe(false);
    // 제안은 저장되지 않는다
    expect(await handle.db.select().from(costItemLinks)).toEqual([]);
    // 자재 목록: 표준구매원가·일반만, 자재번호당 1건
    expect(view.materials.map((m) => m.materialCode).sort()).toEqual([
      'W1700T2',
      'W2600R',
      'WISIGN1700',
      'WKMS1700',
    ]);
    expect(JSON.stringify(view)).not.toMatch(/unit_?cost|unitCost|1000000/i);
  });

  it('read 토큰 없이 부르면 실패한다', async () => {
    await expect(listCostLinkView(undefined as unknown as typeof read, handle.db)).rejects.toThrow(
      /원가 접근 토큰/,
    );
  });
});

describe('confirmCostLinks', () => {
  it('일괄 확정: 확정한 쌍만 저장하고 행마다 감사 1건(변경 전·후 자재번호)', async () => {
    const result = await confirmCostLinks(ctx(), {
      links: [
        { itemCode: 'P1', materialCode: 'W1700T2' },
        { itemCode: 'P2', materialCode: 'W2600R' },
      ],
    });
    expect(result).toEqual({ saved: 2, unchanged: 0 });
    const rows = await handle.db.select().from(costItemLinks).orderBy(costItemLinks.itemCode);
    expect(rows.map((r) => [r.itemCode, r.materialCode])).toEqual([
      ['P1', 'W1700T2'],
      ['P2', 'W2600R'],
    ]);
    const audits = await auditByAction(handle, 'cost_link.upsert');
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      targetType: 'cost_item_link',
      after: { materialCode: expect.any(String) },
    });
    const view = await listCostLinkView(read, handle.db);
    expect(view.candidates.find((c) => c.itemCode === 'P1')?.link).toMatchObject({
      materialCode: 'W1700T2',
      materialName: 'WAPPLES-1700 T2',
    });
  });

  it('같은 자재로 다시 확정하면 unchanged(감사 없음), 다른 자재로 바꾸면 before 기록', async () => {
    expect(
      await confirmCostLinks(ctx(), { links: [{ itemCode: 'P1', materialCode: 'W1700T2' }] }),
    ).toEqual({ saved: 0, unchanged: 1 });
    expect(await auditByAction(handle, 'cost_link.upsert')).toHaveLength(2);
    await confirmCostLinks(ctx(), { links: [{ itemCode: 'P1', materialCode: 'W2600R' }] });
    const audits = await auditByAction(handle, 'cost_link.upsert');
    expect(audits).toHaveLength(3);
    expect(audits.at(-1)).toMatchObject({
      before: { materialCode: 'W1700T2' },
      after: { materialCode: 'W2600R' },
    });
    await confirmCostLinks(ctx(), { links: [{ itemCode: 'P1', materialCode: 'W1700T2' }] });
  });

  it('검증: 품목 마스터에 없는 품목·원가표(표준구매원가·일반)에 없는 자재·같은 품목 다른 자재·빈 목록 → VALIDATION, 저장 없음', async () => {
    const before = await handle.db.select().from(costItemLinks).orderBy(costItemLinks.itemCode);
    for (const links of [
      [{ itemCode: 'NOPE', materialCode: 'W1700T2' }],
      [{ itemCode: 'P6', materialCode: 'WOTHER' }],
      [{ itemCode: 'P6', materialCode: 'W404' }],
      [
        { itemCode: 'P6', materialCode: 'WISIGN1700' },
        { itemCode: 'P6', materialCode: 'W1700T2' },
      ],
    ]) {
      const error = await confirmCostLinks(ctx(), { links }).catch((e: unknown) => e);
      expect(error, JSON.stringify(links)).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VALIDATION');
    }
    await expect(confirmCostLinks(ctx(), { links: [] })).rejects.toThrow();
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      itemCode: `X${i}`,
      materialCode: 'W1700T2',
    }));
    await expect(confirmCostLinks(ctx(), { links: tooMany })).rejects.toThrow();
    expect(await handle.db.select().from(costItemLinks).orderBy(costItemLinks.itemCode)).toEqual(
      before,
    );
  });

  it('read 범위 토큰으로는 확정·해제할 수 없다', async () => {
    await expect(
      confirmCostLinks(
        { handle, access: read, meta: TEST_META },
        { links: [{ itemCode: 'P6', materialCode: 'WISIGN1700' }] },
      ),
    ).rejects.toThrow(/write/);
    await expect(
      deleteCostLink({ handle, access: read, meta: TEST_META }, { itemCode: 'P1' }),
    ).rejects.toThrow(/write/);
  });
});

describe('고아 링크·해제', () => {
  it('품목 마스터에서 사라진 품번의 링크는 orphans(품목 없음), 자동 삭제하지 않는다', async () => {
    await handle.db.insert(costItemLinks).values({ itemCode: 'GONE', materialCode: 'W404' });
    const view = await listCostLinkView(read, handle.db);
    expect(view.orphans).toEqual([
      {
        itemCode: 'GONE',
        materialCode: 'W404',
        materialName: null,
        updatedAt: expect.any(String),
      },
    ]);
    expect(view.candidates.some((c) => c.itemCode === 'GONE')).toBe(false);
  });

  it('해제: 링크 삭제 + 감사(변경 전 자재번호), 없는 품목은 deleted=false·감사 없음', async () => {
    expect(await deleteCostLink(ctx(), { itemCode: 'GONE' })).toEqual({ deleted: true });
    expect(
      await handle.db.select().from(costItemLinks).where(eq(costItemLinks.itemCode, 'GONE')),
    ).toEqual([]);
    const audits = await auditByAction(handle, 'cost_link.delete');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ before: { materialCode: 'W404' } });
    expect(await deleteCostLink(ctx(), { itemCode: 'GONE' })).toEqual({ deleted: false });
    expect(await auditByAction(handle, 'cost_link.delete')).toHaveLength(1);
  });
});
