// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { costItemLinks, importBatches, items, materialCosts, salesPrices } from '@/db/schema';
import { AppError } from '@/lib/result';
import { costAccessForTests } from '@/server/cost/access-token';
import { getCostLinkPicker, getItemLinkCells, ITEM_LINK_CELLS_MAX } from '@/server/cost/item-links';

import { createTestDb } from '../../helpers/pglite';

/**
 * 가격정책 관리 '원가 매핑' 칸·매핑 수정 모달 데이터 (스펙 policy-cost-link-column §2.1-4·§2.2-1·§2.3-2).
 * 칸 5상태(매핑됨·원가표에 없음·미매핑·후보 밖·후보 밖 링크), 요청 품목마다 1개, 모달 요약·제안·영향 건수. 원가 금액 키 없음.
 */
let handle: DbHandle;
const read = costAccessForTests({ id: null, email: 'vitest' }, 'read');
const AMOUNT = /unit_?cost|unitCost|1234567/i;

const ITEMS = [
  // 후보 범위 안(WAPPLES H/W)
  ['P1', 'Wapples-1700 T2 (H1700 T2)', 'WAPPLES', 'H/W Appliance', 'Wapples', '본품', '사용'],
  ['P2', 'Wapples-2600 (H2600)', 'WAPPLES', 'H/W Appliance', 'Wapples', '본품', '폐기'],
  ['P3', 'Wapples-2600 S/W 업그레이드', 'WAPPLES', 'H/W Appliance', 'Wapples', '본품', '사용'],
  // 후보 범위 밖(파츠)
  ['P8', 'NIC 10G', 'WAPPLES', 'Parts', 'NIC', '파츠', '사용'],
  ['P9', 'NIC 1G', 'WAPPLES', 'Parts', 'NIC', '파츠', '사용'],
] as const;

let sourceId = 0;
const price = (itemCode: string, priceType: string, effectiveFrom: string, deleted = false) => ({
  sourceId: ++sourceId,
  productFamily: 'WAPPLES',
  itemCode,
  itemName: ITEMS.find((item) => item[0] === itemCode)?.[1] ?? '마스터 없는 품목',
  unit: 'EA',
  priceType,
  priceCategory: '일반',
  currency: 'KRW',
  hasCorePrice: false,
  unitPrice: '10500000.00',
  effectiveFrom,
  appliesToAllCustomers: true,
  isFinalSource: true,
  baseCoreCount: 0,
  unitPricePerCore: '0.00',
  customerCode: '0',
  source: 'erp' as const,
  deletedAt: deleted ? new Date() : null,
});

beforeAll(async () => {
  handle = await createTestDb();
  const [batch] = await handle.db
    .insert(importBatches)
    .values({ kind: 'item_master', fileName: 'cells.xlsx', fileSha256: 'cells', fileSize: 1 })
    .returning({ id: importBatches.id });
  await handle.db.insert(items).values(
    ITEMS.map(([itemCode, itemName, categoryMajor, categoryMid, categoryMinor, itemKind, st]) => ({
      itemCode,
      itemName,
      categoryMajor,
      categoryMid,
      categoryMinor,
      itemKind,
      itemStatus: st,
      itemStatusRaw: st,
      importBatchId: batch!.id,
    })),
  );
  await handle.db.insert(materialCosts).values(
    [
      ['W1700T2', 'WAPPLES-1700 T2', '2026-01-01'],
      ['W1700T2', 'WAPPLES-1700 T2 (개정)', '2026-07-01'],
      ['W2600', 'WAPPLES-2600', '2026-01-01'],
    ].map(([materialCode, materialName, effectiveFrom], i) => ({
      materialCode: materialCode!,
      materialName: materialName!,
      unit: 'EA',
      priceType: '표준구매원가',
      priceCategory: '일반',
      currency: 'KRW',
      unitCost: '1234567.00',
      effectiveFrom: effectiveFrom!,
      isFinalSource: true,
      appliesToAllCustomers: true,
      source: 'erp' as const,
      sourceRow: i + 1,
    })),
  );
  await handle.db.insert(costItemLinks).values([
    { itemCode: 'P1', materialCode: 'W1700T2' },
    // 원가표에서 사라진 자재
    { itemCode: 'P2', materialCode: 'WGONE' },
    // 후보 밖인데 링크 있음
    { itemCode: 'P9', materialCode: 'W2600' },
    // 품목 마스터에 없는 품번(가격 행만 있음)
    { itemCode: 'PX', materialCode: 'W2600' },
  ]);
  await handle.db
    .insert(salesPrices)
    .values([
      price('P1', '정상판매', '2025-01-01'),
      price('P1', '정상판매', '2026-01-01'),
      price('P1', '대리점', '2026-01-01'),
      price('P1', '정상판매', '2024-01-01', true),
      price('PX', '정상판매', '2026-01-01'),
    ]);
});

afterAll(async () => {
  await handle.close();
});

describe('getItemLinkCells', () => {
  it('5상태: 매핑됨·원가표에 없음·미매핑·후보 밖(링크 없음)·후보 밖(링크 있음), 요청 품목마다 1개, 마스터 없는 품번 = 후보 밖', async () => {
    const cells = await getItemLinkCells(read, handle.db, [
      'P1',
      'P2',
      'P3',
      'P8',
      'P9',
      'PX',
      'P1',
    ]);
    expect(cells).toEqual({
      P1: {
        inScope: true,
        link: {
          materialCode: 'W1700T2',
          materialName: 'WAPPLES-1700 T2 (개정)',
          inCostTable: true,
        },
      },
      P2: {
        inScope: true,
        link: { materialCode: 'WGONE', materialName: null, inCostTable: false },
      },
      P3: { inScope: true, link: null },
      P8: { inScope: false, link: null },
      P9: {
        inScope: false,
        link: { materialCode: 'W2600', materialName: 'WAPPLES-2600', inCostTable: true },
      },
      PX: {
        inScope: false,
        link: { materialCode: 'W2600', materialName: 'WAPPLES-2600', inCostTable: true },
      },
    });
    expect(JSON.stringify(cells)).not.toMatch(AMOUNT);
  });

  it(`빈 목록 → {} / 최대 ${ITEM_LINK_CELLS_MAX}개 / read 토큰 필수`, async () => {
    expect(await getItemLinkCells(read, handle.db, [])).toEqual({});
    const many = Array.from({ length: ITEM_LINK_CELLS_MAX + 5 }, (_, i) => `Q${i}`);
    expect(Object.keys(await getItemLinkCells(read, handle.db, many))).toHaveLength(
      ITEM_LINK_CELLS_MAX,
    );
    await expect(
      getItemLinkCells(undefined as unknown as typeof read, handle.db, ['P1']),
    ).rejects.toThrow(/원가 접근 토큰/);
  });
});

describe('getCostLinkPicker', () => {
  it('후보 안·매핑됨: 품목 요약·현재 매핑·제안·자재 목록·영향 건수(삭제 제외 가격 행 N·정상판매 M), 금액 없음', async () => {
    const data = await getCostLinkPicker(read, handle.db, 'P1');
    expect(data).toEqual({
      item: {
        itemCode: 'P1',
        itemName: 'Wapples-1700 T2 (H1700 T2)',
        family: 'WAPPLES',
        categoryMinor: 'Wapples',
        itemStatus: '사용',
        inScope: true,
      },
      link: { materialCode: 'W1700T2', materialName: 'WAPPLES-1700 T2 (개정)', inCostTable: true },
      suggestion: { materialCode: 'W1700T2', materialName: 'WAPPLES-1700 T2 (개정)' },
      noSuggestion: null,
      materials: [
        { materialCode: 'W1700T2', materialName: 'WAPPLES-1700 T2 (개정)' },
        { materialCode: 'W2600', materialName: 'WAPPLES-2600' },
      ],
      impact: { priceRows: 3, normalPriceRows: 2 },
    });
    expect(JSON.stringify(data)).not.toMatch(AMOUNT);
  });

  it('제안 없음 사유(S/W 업그레이드)·가격 행 0건', async () => {
    const data = await getCostLinkPicker(read, handle.db, 'P3');
    expect(data).toMatchObject({
      link: null,
      suggestion: null,
      noSuggestion: 'sw-upgrade',
      impact: { priceRows: 0, normalPriceRows: 0 },
    });
  });

  it('원가표에 없는 자재 링크: inCostTable=false, 자재명 null', async () => {
    expect((await getCostLinkPicker(read, handle.db, 'P2')).link).toEqual({
      materialCode: 'WGONE',
      materialName: null,
      inCostTable: false,
    });
  });

  it('후보 밖: 제품군·제안 없음(inScope=false). 마스터에 없는 품번은 가격 행 품명으로 요약', async () => {
    expect(await getCostLinkPicker(read, handle.db, 'P9')).toMatchObject({
      item: { inScope: false, family: null, itemName: 'NIC 1G' },
      link: { materialCode: 'W2600' },
      suggestion: null,
      noSuggestion: null,
    });
    expect(await getCostLinkPicker(read, handle.db, 'PX')).toMatchObject({
      item: { itemCode: 'PX', itemName: '마스터 없는 품목', inScope: false, itemStatus: null },
      impact: { priceRows: 1, normalPriceRows: 1 },
    });
  });

  it('품목·가격 행 모두 없으면 NOT_FOUND', async () => {
    const error = await getCostLinkPicker(read, handle.db, 'NOPE').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('NOT_FOUND');
  });
});
