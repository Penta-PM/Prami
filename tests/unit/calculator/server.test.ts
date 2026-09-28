// @vitest-environment node
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { items, quoteLines, quotes, salesPrices } from '@/db/schema';
import { computeLine } from '@/lib/pricing/quote';
import { AppError } from '@/lib/result';
import { upsertSolutionGroup } from '@/server/groups/mutations';
import { applyPolicy } from '@/server/imports/apply-policy';
import { savePartMapping } from '@/server/parts/mutations';
import {
  listGroupHardware,
  listQuoteBundles,
  listQuoteCategories,
  listQuoteItems,
  listQuoteParts,
  listQuotePriceTypes,
} from '@/server/quotes/catalog';
import { deleteQuote, nextQuoteNo, saveQuote, type QuotesContext } from '@/server/quotes/mutations';
import { listMyQuotes } from '@/server/quotes/queries';
import { queryRows } from '@/server/imports/sql-rows';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 견적 서버 (§4.5.7): STEP1 단가유형 = DB DISTINCT(AC-61), STEP3 최신 행 가격, STEP4 part_mappings 우선(AC-62),
 * 저장 = 스냅샷 + Q-YYYY-NNNN 시퀀스(AC-63), 정책 변경 후 금액 불변(AC-66), 본인 견적만(ADMIN 전체).
 */
let handle: DbHandle;
let userCtx: QuotesContext;
let otherCtx: QuotesContext;
let adminCtx: QuotesContext;
const N_51080 = 'P10800011';
const YEAR = new Date().getFullYear();

const ctxFor = (user: { id: string; email: string; role: 'USER' | 'ADMIN' }): QuotesContext => ({
  handle,
  actor: { id: user.id, label: user.email, role: user.role },
  meta: TEST_META,
});

beforeAll(async () => {
  handle = await createTestDb();
  userCtx = ctxFor(await insertUser(handle, { email: 'user@pentasecurity.com', role: 'USER' }));
  otherCtx = ctxFor(await insertUser(handle, { email: 'other@pentasecurity.com', role: 'USER' }));
  adminCtx = ctxFor(await insertUser(handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }));
  const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
});

afterAll(async () => {
  await handle.close();
});

async function sqlPriceTypes(family: string) {
  const rows = await queryRows<{ price_type: string }>(
    handle.db,
    sql`select distinct price_type from sales_prices where deleted_at is null and operation_status = '운영중' and product_family = ${family} and price_type is not null`,
  );
  return new Set(rows.map((row) => row.price_type));
}

describe('STEP1~5 후보', () => {
  it('AC-61: 단가유형 = 운영중 행의 DISTINCT price_type (SQL 대조), 품목 가격 = 그 단가유형 최신 행', async () => {
    const options = await listQuotePriceTypes(handle.db, 'WAPPLES');
    expect(new Set(options.map((option) => option.priceType))).toEqual(
      await sqlPriceTypes('WAPPLES'),
    );
    expect(options[0]!.count).toBeGreaterThanOrEqual(options.at(-1)!.count);
    const normal = await listQuoteItems(handle.db, { family: 'WAPPLES', priceType: '정상판매' });
    expect(normal.length).toBeGreaterThan(0);
    expect(normal.every((item) => item.priceType === '정상판매')).toBe(true);
    expect(normal.some((item) => item.kind === '파츠')).toBe(false);
    const [sample] = normal;
    const [latest] = await queryRows<{ unit_price: string }>(
      handle.db,
      sql`select unit_price from sales_prices where item_code = ${sample!.itemCode} and price_type = '정상판매' and operation_status = '운영중' and deleted_at is null order by effective_from desc, id desc limit 1`,
    );
    expect(sample!.unitPrice).toBe(latest!.unit_price);
    // 배수 없음: ASP 품목 가격은 ASP 행 자체 가격
    const asp = await listQuoteItems(handle.db, { family: 'WAPPLES', priceType: 'ASP' });
    expect(asp.length).toBeGreaterThan(0);
    expect(asp.every((item) => item.priceType === 'ASP')).toBe(true);
    expect(await listQuoteItems(handle.db, { family: 'WAPPLES', priceType: '없는유형' })).toEqual(
      [],
    );
  });

  it('STEP2: 마스터 없으면 대분류 = 제품군, 중/소 없음', async () => {
    expect(await listQuoteCategories(handle.db, 'WAPPLES')).toEqual({
      majors: ['WAPPLES'],
      mids: [],
      minors: [],
      hasMaster: false,
    });
  });

  it('AC-62: part_mappings 가 있으면 그 파츠만, 없으면 제품군 파츠 전체(fallback); 결합형은 마스터 없으면 빈 목록', async () => {
    const [model] = await listQuoteItems(handle.db, { family: 'WAPPLES', priceType: '정상판매' });
    const before = await listQuoteParts(handle.db, {
      family: 'WAPPLES',
      priceType: '정상판매',
      modelItemCode: model!.itemCode,
    });
    expect(before.mapped).toBe(false);
    expect(before.parts.length).toBeGreaterThan(1);
    expect(before.parts.every((part) => part.kind === '파츠')).toBe(true);

    await savePartMapping(
      { handle, actor: adminCtx.actor, meta: TEST_META },
      { modelItemCode: model!.itemCode, partItemCodes: [N_51080] },
    );
    const after = await listQuoteParts(handle.db, {
      family: 'WAPPLES',
      priceType: '정상판매',
      modelItemCode: model!.itemCode,
    });
    expect(after.mapped).toBe(true);
    expect(after.parts.map((part) => part.itemCode)).toEqual([N_51080]);
    // 선택 단가유형(ASP)에 파츠 행이 없으면 정상판매 가격으로 fallback
    const asp = await listQuoteParts(handle.db, {
      family: 'WAPPLES',
      priceType: 'ASP',
      modelItemCode: model!.itemCode,
    });
    expect(asp.parts.map((part) => part.itemCode)).toEqual([N_51080]);
    expect(await listQuoteBundles(handle.db, { family: 'WAPPLES', priceType: '정상판매' })).toEqual(
      [],
    );
    expect(
      (await listGroupHardware(handle.db, 'WAPPLES')).every((row) => row.kind === '본품'),
    ).toBe(true);
  });
});

describe('saveQuote / listMyQuotes / deleteQuote', () => {
  // sales-200 픽스처의 실제 행 — 서버 재가격화(reprice.ts)가 DB 운영중 최신 행을 요구한다 (PR-7 QA MEDIUM)
  const MODEL = { itemCode: 'P10100015', name: 'Wapples-500 (H500 T2)', unitPrice: 12_000_000 };
  let part: { itemCode: string; itemName: string; unitPrice: number };
  const line = (over: Partial<Parameters<typeof saveQuote>[1]['lines'][number]> = {}) => ({
    kind: 'item' as const,
    itemCode: MODEL.itemCode,
    name: MODEL.name,
    priceType: '정상판매',
    qty: 2,
    unitPrice: MODEL.unitPrice,
    currency: 'KRW',
    parts: [part],
    bundles: [],
    groupItems: [],
    discountRate: 12.5,
    ...over,
  });
  const honest = () =>
    computeLine({ basePrice: MODEL.unitPrice, parts: [part], qty: 2, discountRate: 12.5 });

  beforeAll(async () => {
    const { parts } = await listQuoteParts(handle.db, {
      family: 'WAPPLES',
      priceType: '정상판매',
      modelItemCode: MODEL.itemCode,
    });
    const first = parts[0];
    if (!first) throw new Error('픽스처에 WAPPLES 파츠가 없습니다');
    part = {
      itemCode: first.itemCode,
      itemName: first.itemName,
      unitPrice: Number(first.unitPrice),
    };
  });

  it('AC-63: 저장 → Q-YYYY-0001, 서버가 DB 단가로 다시 계산한 스냅샷 라인, 감사 quote.save', async () => {
    const expected = honest();
    const saved = await saveQuote(userCtx, { productFamily: 'WAPPLES', lines: [line()] });
    expect(saved).toMatchObject({
      quoteNo: `Q-${YEAR}-0001`,
      totalAmount: String(expected.lineTotal),
      currency: 'KRW',
      lineCount: 1,
      adjustments: [],
    });
    const [head] = await handle.db.select().from(quotes).where(eq(quotes.id, saved.id));
    expect(head).toMatchObject({ productFamily: 'WAPPLES', title: `WAPPLES 견적 Q-${YEAR}-0001` });
    const [row] = await handle.db.select().from(quoteLines).where(eq(quoteLines.quoteId, saved.id));
    expect(row).toMatchObject({
      lineNo: 1,
      kind: 'item',
      itemCode: MODEL.itemCode,
      qty: 2,
      unitPrice: '12000000.00',
      discountRate: '12.5',
      preDiscount: expected.preDiscount.toFixed(2),
      lineTotal: expected.lineTotal.toFixed(2),
    });
    expect(row!.options).toMatchObject({
      name: MODEL.name,
      currency: 'KRW',
      parts: [{ itemCode: part.itemCode, unitPrice: part.unitPrice }],
    });
    expect((await auditByAction(handle, 'quote.save')).at(-1)).toMatchObject({
      targetId: saved.id,
      result: 'success',
      after: expect.objectContaining({ adjustments: 0 }) as unknown,
    });
    const second = await saveQuote(userCtx, {
      productFamily: 'WAPPLES',
      lines: [line({ qty: 1 })],
    });
    expect(second.quoteNo).toBe(`Q-${YEAR}-0002`);
  });

  it('PR-7 QA MEDIUM (회귀): 조작된 단가(1원)·파츠 단가·통화는 서버가 DB 값으로 대체하고 보정 내역을 남긴다', async () => {
    const expected = honest();
    const forged = await saveQuote(userCtx, {
      productFamily: 'WAPPLES',
      lines: [line({ unitPrice: 1, currency: 'usd', parts: [{ ...part, unitPrice: 1 }] })],
    });
    expect(forged.totalAmount).toBe(String(expected.lineTotal));
    expect(forged.currency).toBe('KRW');
    expect(forged.adjustments).toEqual([
      expect.objectContaining({
        lineNo: 1,
        itemCode: MODEL.itemCode,
        field: 'unitPrice',
        client: '1',
        server: '12000000',
      }),
      expect.objectContaining({
        lineNo: 1,
        itemCode: MODEL.itemCode,
        field: 'currency',
        client: 'USD',
        server: 'KRW',
      }),
      expect.objectContaining({
        lineNo: 1,
        itemCode: part.itemCode,
        field: 'unitPrice',
        client: '1',
        server: String(part.unitPrice),
      }),
    ]);
    const [row] = await handle.db
      .select()
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, forged.id));
    expect(row!.unitPrice).toBe('12000000.00');
    expect(row!.options).toMatchObject({ currency: 'KRW', parts: [{ unitPrice: part.unitPrice }] });
    expect((await auditByAction(handle, 'quote.save')).at(-1)).toMatchObject({
      after: expect.objectContaining({ adjustments: 3 }) as unknown,
    });

    // 없는 품번·없는 단가유형·없는 파츠는 저장 거부 (VALIDATION, 견적 미생성)
    const count = await handle.db.$count(quotes);
    for (const bad of [
      line({ itemCode: 'NOPE-1', name: '없는 품목' }),
      line({ priceType: '없는유형' }),
      line({ parts: [{ itemCode: 'NOPE-P', itemName: '없는 파츠', unitPrice: 5 }] }),
    ]) {
      await expect(
        saveQuote(userCtx, { productFamily: 'WAPPLES', lines: [bad] }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    expect(await handle.db.$count(quotes)).toBe(count);
  });

  it('AC-65: 통화가 섞이면 totalAmount·currency 는 null, 제품군이 여럿이면 제목에 표시 (QA INFO-3)', async () => {
    // 픽스처는 전부 KRW/WAPPLES 라 한 품목을 USD·Cloudbric 으로 바꿔 둔다
    await handle.db
      .update(salesPrices)
      .set({ currency: 'USD', unitPrice: '10.00', productFamily: 'Cloudbric' })
      .where(and(eq(salesPrices.itemCode, 'P10100014'), eq(salesPrices.priceType, '정상판매')));
    const mixed = await saveQuote(userCtx, {
      productFamily: 'WAPPLES',
      lines: [
        line(),
        line({
          itemCode: 'P10100014',
          name: 'Wapples-100',
          currency: 'USD',
          unitPrice: 10,
          parts: [],
          discountRate: 0,
        }),
      ],
    });
    expect(mixed.currency).toBeNull();
    expect(mixed.adjustments).toEqual([]);
    const [row] = await handle.db.select().from(quotes).where(eq(quotes.id, mixed.id));
    expect(row?.totalAmount).toBeNull();
    expect(row?.productFamily).toBe('WAPPLES');
    expect(row?.title).toBe(`복수 제품군(WAPPLES, Cloudbric) 견적 Q-${YEAR}-0004`);
  });

  it('AC-66: 정책(판매단가)이 바뀌어도 저장된 견적 금액은 그대로', async () => {
    const [before] = await listMyQuotes(handle.db, { id: userCtx.actor.id, role: 'USER' });
    const scope = and(
      eq(salesPrices.itemCode, MODEL.itemCode),
      eq(salesPrices.priceType, '정상판매'),
    );
    await handle.db.update(salesPrices).set({ unitPrice: '1.00' }).where(scope);
    await handle.db.update(items).set({ itemName: '바뀐 품명' });
    const [after] = await listMyQuotes(handle.db, { id: userCtx.actor.id, role: 'USER' });
    expect(after).toEqual(before);
    expect(after!.lines[0]!.lineTotal).toBe(before!.lines[0]!.lineTotal);
    await handle.db.update(salesPrices).set({ unitPrice: '12000000.00' }).where(scope);
  });

  it('목록은 본인 것만(최신순), ADMIN 은 전체; 다른 사용자의 삭제는 FORBIDDEN, 본인 삭제는 soft + 감사', async () => {
    const mine = await listMyQuotes(handle.db, { id: userCtx.actor.id, role: 'USER' });
    expect(mine).toHaveLength(4);
    expect(mine.every((quote) => quote.ownerUserId === userCtx.actor.id)).toBe(true);
    expect(mine.map((quote) => quote.quoteNo)).toEqual([
      `Q-${YEAR}-0004`,
      `Q-${YEAR}-0003`,
      `Q-${YEAR}-0002`,
      `Q-${YEAR}-0001`,
    ]);
    expect(await listMyQuotes(handle.db, { id: otherCtx.actor.id, role: 'USER' })).toEqual([]);
    expect(await listMyQuotes(handle.db, { id: adminCtx.actor.id, role: 'ADMIN' })).toHaveLength(4);

    const target = mine[0]!;
    const denied = await deleteQuote(otherCtx, { id: target.id }).catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(AppError);
    expect((denied as AppError).code).toBe('FORBIDDEN');
    expect(await deleteQuote(userCtx, { id: target.id })).toEqual({
      id: target.id,
      quoteNo: target.quoteNo,
    });
    expect(
      (await listMyQuotes(handle.db, { id: userCtx.actor.id, role: 'USER' })).map((q) => q.id),
    ).not.toContain(target.id);
    const [row] = await handle.db.select().from(quotes).where(eq(quotes.id, target.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect((await auditByAction(handle, 'quote.delete')).at(-1)).toMatchObject({
      targetId: target.id,
    });
    await expect(deleteQuote(userCtx, { id: target.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // ADMIN 은 남의 견적도 삭제 가능
    expect(await deleteQuote(adminCtx, { id: mine[1]!.id })).toMatchObject({
      quoteNo: `Q-${YEAR}-0003`,
    });
  });

  it('번호는 삭제된 견적을 건너뛰지 않고 이어지며 동시 저장도 서로 다른 번호를 받는다', async () => {
    expect(await handle.db.transaction((tx) => nextQuoteNo(tx, YEAR))).toBe(`Q-${YEAR}-0005`);
    const results = await Promise.all(
      [1, 2, 3].map((qty) =>
        saveQuote(userCtx, { productFamily: 'WAPPLES', lines: [line({ qty })] }),
      ),
    );
    expect(new Set(results.map((result) => result.quoteNo)).size).toBe(3);
    expect(await handle.db.transaction((tx) => nextQuoteNo(tx, YEAR + 1))).toBe(
      `Q-${YEAR + 1}-0001`,
    );
  });

  it('검증: 빈 장바구니·잘못된 통화는 ZodError', async () => {
    await expect(saveQuote(userCtx, { productFamily: 'WAPPLES', lines: [] })).rejects.toMatchObject(
      { name: 'ZodError' },
    );
    await expect(
      saveQuote(userCtx, { productFamily: 'WAPPLES', lines: [line({ currency: 'wonx' })] }),
    ).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('그룹 라인: PR-6 그룹을 담아 저장하면 상세 제품 스냅샷이 남고 단가는 정상판매 최신 행으로 확정된다 (AC-33 서버)', async () => {
    const [model, other] = await listQuoteItems(handle.db, {
      family: 'WAPPLES',
      priceType: '정상판매',
    });
    const group = await upsertSolutionGroup(
      { handle, actor: adminCtx.actor, meta: TEST_META },
      {
        productFamily: 'WAPPLES',
        name: 'G',
        items: [{ itemCode: model!.itemCode }, { itemCode: other!.itemCode, defaultQty: 2 }],
      },
    );
    const expected = Number(model!.unitPrice) + Number(other!.unitPrice) * 2;
    const saved = await saveQuote(userCtx, {
      productFamily: 'WAPPLES',
      lines: [
        {
          kind: 'group',
          groupId: group.id,
          itemCode: model!.itemCode,
          name: `G · ${model!.itemName}`,
          qty: 1,
          unitPrice: 1_000_000,
          currency: 'KRW',
          parts: [],
          bundles: [],
          groupItems: [
            { itemCode: other!.itemCode, itemName: other!.itemName, unitPrice: 100_500, qty: 2 },
          ],
          discountRate: 0,
        },
      ],
    });
    expect(saved.totalAmount).toBe(String(expected));
    expect(saved.adjustments.map((entry) => entry.itemCode)).toEqual([
      model!.itemCode,
      other!.itemCode,
    ]);
    const [row] = await handle.db.select().from(quoteLines).where(eq(quoteLines.quoteId, saved.id));
    expect(row).toMatchObject({
      kind: 'group',
      groupId: group.id,
      unitPrice: Number(model!.unitPrice).toFixed(2),
      preDiscount: expected.toFixed(2),
      lineTotal: expected.toFixed(2),
    });
    expect(row!.options).toMatchObject({
      groupItems: [{ itemCode: other!.itemCode, unitPrice: Number(other!.unitPrice), qty: 2 }],
    });
  });
});
