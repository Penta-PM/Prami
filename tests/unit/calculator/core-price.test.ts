// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { quoteLines, salesPrices } from '@/db/schema';
import {
  cartReducer,
  describeLine,
  linesFromSavedQuote,
  toLineInput,
} from '@/features/calculator/cart';
import { corePricing, defaultCores, parseCores } from '@/features/calculator/cores';
import { quoteDraftOf } from '@/features/calculator/drafts';
import type { QuoteFormState, QuoteItemView } from '@/features/calculator/types';
import { cartLineDraftSchema, parseDraft, quoteDraftSchema } from '@/lib/page-state/drafts';
import { coreLineLabel } from '@/lib/pricing/format';
import { computeLine, coreApplies, coreUnitPrice } from '@/lib/pricing/quote';
import { applyPolicy } from '@/server/imports/apply-policy';
import { resolveCartDraft } from '@/server/page-state/draft-restore';
import { listQuoteItems } from '@/server/quotes/catalog';
import { loadQuoteDocument } from '@/server/quotes/document';
import { saveQuote, type QuotesContext } from '@/server/quotes/mutations';
import { listMyQuotes } from '@/server/quotes/queries';
import { repriceDryRun } from '@/server/quotes/reprice';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb, insertUser } from '../../helpers/pglite';

/** D.AMO 코어 단가 (Plan docs/specs/damo-core-price.md §2·§3·§4·§6) */
const CORE_ROW = {
  unitPrice: 10_000_000,
  hasCorePrice: true,
  baseCoreCount: 4,
  unitPricePerCore: 1_500_000,
};

describe('coreUnitPrice (§2 공식, §6 수용 기준)', () => {
  it('코어 수 = 기준 → 단가', () => {
    expect(coreUnitPrice(CORE_ROW, 4)).toBe(10_000_000);
  });
  it('6코어(기준 4) = 단가 + 2 × 1코어 단가', () => {
    expect(coreUnitPrice(CORE_ROW, 6)).toBe(10_000_000 + 2 * 1_500_000);
  });
  it('N 행·Y + 기준 0(조달, D4)·코어 수 없음 → 단가', () => {
    expect(coreUnitPrice({ ...CORE_ROW, hasCorePrice: false }, 6)).toBe(10_000_000);
    expect(coreUnitPrice({ ...CORE_ROW, baseCoreCount: 0 }, 6)).toBe(10_000_000);
    expect(coreUnitPrice(CORE_ROW, undefined)).toBe(10_000_000);
    expect(coreApplies({ hasCorePrice: true, baseCoreCount: 0 })).toBe(false);
  });
  it('기준 미만은 감액하지 않는다 (D1)', () => {
    expect(coreUnitPrice(CORE_ROW, 2)).toBe(10_000_000);
  });
  it('computeLine 본품가로 넘기면 할인은 추가 코어 포함 라인 전체에 (D6)', () => {
    const line = computeLine({ basePrice: coreUnitPrice(CORE_ROW, 6), qty: 2, discountRate: 10 });
    expect(line.preDiscount).toBe(26_000_000);
    expect(line.lineTotal).toBe(23_400_000);
  });
});

const VIEW: QuoteItemView = {
  itemCode: 'DA-1',
  itemName: 'D.AMO KE',
  unitPrice: '10000000.00',
  currency: 'KRW',
  priceType: '정상판매',
  kind: '본품',
  hasCorePrice: true,
  baseCoreCount: 4,
  unitPricePerCore: '1500000.00',
};

describe('계산기 코어 입력 (§3 D1·D2·D5, §4)', () => {
  it('기본값 = 기준, 저장값 복원, 기준 미만 저장값은 기준으로, N 품목은 빈 값', () => {
    expect(defaultCores(VIEW)).toBe('4');
    expect(defaultCores(VIEW, 6)).toBe('6');
    expect(defaultCores(VIEW, 2)).toBe('4');
    expect(defaultCores({ ...VIEW, hasCorePrice: false })).toBe('');
    expect(defaultCores({ ...VIEW, baseCoreCount: 0 })).toBe('');
  });
  it('정수·기준 이상·1,024 이하만 통과', () => {
    expect(parseCores('6', 4)).toEqual({ cores: 6, error: null });
    expect(parseCores('3', 4).error).toBe('기준 4코어 이상으로 입력하세요');
    expect(parseCores('4.5', 4).error).toBe('코어 수는 정수로 입력하세요');
    expect(parseCores('', 4).error).toBe('코어 수는 정수로 입력하세요');
    expect(parseCores('1025', 4).error).toBe('1,024코어 이하로 입력하세요');
    expect(parseCores('1024', 4).cores).toBe(1024);
  });
  it('corePricing: 코어 반영 단가 + 스냅샷, N 품목은 스냅샷 없음', () => {
    expect(corePricing(VIEW, 6)).toEqual({
      unitPrice: 13_000_000,
      core: { cores: 6, baseCoreCount: 4, unitPricePerCore: 1_500_000, baseUnitPrice: 10_000_000 },
    });
    expect(corePricing({ ...VIEW, hasCorePrice: false }, 6)).toEqual({ unitPrice: 10_000_000 });
  });
  it('견적서·PDF 하위 줄: 추가 코어 / 기준 그대로', () => {
    const core = { cores: 6, baseCoreCount: 4, unitPricePerCore: 1_500_000 };
    expect(coreLineLabel(core, 'KRW')).toBe(
      '+ 추가 코어 2 × 1,500,000원 (기준 4코어 포함, 총 6코어)',
    );
    expect(coreLineLabel({ ...core, cores: 4 }, 'KRW')).toBe('기준 4코어');
  });
});

describe('장바구니·초안 (§4)', () => {
  const core = {
    cores: 6,
    baseCoreCount: 4,
    unitPricePerCore: 1_500_000,
    baseUnitPrice: 10_000_000,
  };
  const line = {
    kind: 'item' as const,
    itemCode: 'DA-1',
    name: 'D.AMO KE',
    priceType: '정상판매',
    qty: 2,
    unitPrice: 13_000_000,
    currency: 'KRW',
    parts: [],
    bundles: [],
    groupItems: [],
    discountRate: 0,
    coreCount: 6,
    core,
  };

  it('장바구니 요약에 6코어 토큰, 저장 입력에는 coreCount 만(core 표시값 제외), 금액 = 수량 × 코어 반영 단가', () => {
    const { lines } = cartReducer({ lines: [] }, { type: 'add', line });
    expect(describeLine(lines[0]!)).toBe('정상판매 · 6코어 · × 2');
    expect(lines[0]!.preDiscount).toBe(26_000_000);
    const input = toLineInput(lines[0]!);
    expect(input.coreCount).toBe(6);
    expect(input).not.toHaveProperty('core');
    expect(cartLineDraftSchema.parse(input).coreCount).toBe(6);
  });

  it('N 라인은 코어 토큰·필드가 없다 (기존 결과 불변)', () => {
    const { lines } = cartReducer(
      { lines: [] },
      {
        type: 'add',
        line: { ...line, coreCount: undefined, core: undefined, unitPrice: 10_000_000 },
      },
    );
    expect(describeLine(lines[0]!)).toBe('정상판매 · × 2');
    expect(toLineInput(lines[0]!)).not.toHaveProperty('coreCount');
  });

  it('linesFromSavedQuote: options.core 로 코어 수 복원, 옛 견적(core 없음)은 코어 없음', () => {
    const savedLine = {
      kind: 'item' as const,
      itemCode: 'DA-1',
      groupId: null,
      priceType: '정상판매',
      name: 'D.AMO KE',
      qty: 2,
      unitPrice: '13000000.00',
      currency: 'KRW',
      parts: [],
      bundles: [],
      groupItems: [],
      discountRate: '0.0',
      preDiscount: '26000000.00',
      lineTotal: '26000000.00',
    };
    const quote = {
      id: 'q',
      quoteNo: 'Q-1',
      productFamily: 'D.AMO',
      title: 't',
      summary: null,
      totalAmount: null,
      currency: null,
      createdAt: '2026-11-05T00:00:00.000Z',
      ownerUserId: 'u',
      lines: [{ ...savedLine, core }, savedLine],
    };
    const [withCore, legacy] = linesFromSavedQuote(quote);
    expect(withCore).toMatchObject({ coreCount: 6, unitPrice: 13_000_000, core });
    expect(legacy).not.toHaveProperty('coreCount');
  });

  it('견적 입력 초안: 코어 품목이고 입력이 올바를 때만 coreCount, 옛 초안(coreCount 없음)도 읽힌다', () => {
    const form: QuoteFormState = {
      family: 'D.AMO',
      priceType: '정상판매',
      mid: null,
      minor: null,
      selected: VIEW,
      qty: 1,
      cores: '6',
      parts: [],
      bundles: [],
      rate: 0,
      target: '',
    };
    const defaults = { family: 'WAPPLES', priceType: '정상판매' };
    expect(quoteDraftOf(form, defaults)?.coreCount).toBe(6);
    expect(quoteDraftOf({ ...form, cores: '3' }, defaults)).not.toHaveProperty('coreCount');
    const draft = quoteDraftOf({ ...form, cores: '6' }, defaults)!;
    const legacy: Partial<typeof draft> = { ...draft };
    delete legacy.coreCount;
    expect(parseDraft('quote', 1, legacy)).toEqual(legacy);
    expect(quoteDraftSchema.safeParse({ ...draft, coreCount: 2000 }).success).toBe(false);
  });
});

describe('서버 재가격화·저장·문서 (§2·§4, pglite)', () => {
  let handle: DbHandle;
  let ctx: QuotesContext;
  let model: { itemCode: string; itemName: string; unitPrice: number; family: string };
  let normal: { itemCode: string; itemName: string; unitPrice: number };
  const PER_CORE = 1_500_000;

  const line = (over: Record<string, unknown> = {}) => ({
    kind: 'item' as const,
    itemCode: model.itemCode,
    name: model.itemName,
    priceType: '정상판매',
    qty: 2,
    unitPrice: model.unitPrice + 2 * PER_CORE,
    currency: 'KRW',
    parts: [],
    bundles: [],
    groupItems: [],
    discountRate: 10,
    coreCount: 6,
    ...over,
  });

  beforeAll(async () => {
    handle = await createTestDb();
    const user = await insertUser(handle, { email: 'core@pentasecurity.com', role: 'USER' });
    ctx = { handle, actor: { id: user.id, label: user.email, role: 'USER' }, meta: TEST_META };
    const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
    await applyPolicy(
      { handle, actor: TEST_ACTOR, meta: TEST_META },
      { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
    );
    // 픽스처에는 코어 Y 행이 없다 — 정상판매 품목 하나를 기준 4코어·1코어 단가로 표시한다
    const [first, second] = await listQuoteItems(handle.db, {
      family: 'WAPPLES',
      priceType: '정상판매',
    });
    if (!first || !second) throw new Error('픽스처에 정상판매 품목이 없습니다');
    model = { ...first, unitPrice: Number(first.unitPrice), family: 'WAPPLES' };
    normal = { ...second, unitPrice: Number(second.unitPrice) };
    await handle.db
      .update(salesPrices)
      .set({ hasCorePrice: true, baseCoreCount: 4, unitPricePerCore: String(PER_CORE) })
      .where(and(eq(salesPrices.itemCode, model.itemCode), eq(salesPrices.priceType, '정상판매')));
  });

  afterAll(async () => {
    await handle.close();
  });

  it('카탈로그: 같은 행의 코어 3필드를 함께 내려준다', async () => {
    const rows = await listQuoteItems(handle.db, { family: 'WAPPLES', priceType: '정상판매' });
    expect(rows.find((row) => row.itemCode === model.itemCode)).toMatchObject({
      hasCorePrice: true,
      baseCoreCount: 4,
      unitPricePerCore: '1500000.00',
    });
    expect(rows.find((row) => row.itemCode === normal.itemCode)).toMatchObject({
      hasCorePrice: false,
    });
  });

  it('6코어 저장: 보정 경고 없음, unit_price = 코어 반영 단가, options.core 스냅샷, 목록·문서에서 다시 읽힌다', async () => {
    const saved = await saveQuote(ctx, { productFamily: model.family, lines: [line()] });
    expect(saved.adjustments).toEqual([]);
    const expected = computeLine({
      basePrice: model.unitPrice + 2 * PER_CORE,
      qty: 2,
      discountRate: 10,
    });
    expect(saved.totalAmount).toBe(String(expected.lineTotal));
    const [row] = await handle.db.select().from(quoteLines).where(eq(quoteLines.quoteId, saved.id));
    expect(row!.unitPrice).toBe((model.unitPrice + 2 * PER_CORE).toFixed(2));
    const core = {
      cores: 6,
      baseCoreCount: 4,
      unitPricePerCore: PER_CORE,
      baseUnitPrice: model.unitPrice,
    };
    expect(row!.options).toMatchObject({ core });

    const [listed] = await listMyQuotes(handle.db, { id: ctx.actor.id, role: 'USER' });
    expect(listed!.lines[0]!.core).toEqual(core);
    const document = await loadQuoteDocument(handle.db, saved.id);
    expect(document!.lines[0]!.core).toEqual(core);

    // 담기 → 다시 저장해도 코어 수·금액 유지, 보정 경고 없음 (§6)
    const again = linesFromSavedQuote({ ...listed!, lines: listed!.lines });
    const resaved = await saveQuote(ctx, {
      productFamily: model.family,
      lines: again.map((entry) => ({ ...entry })),
    });
    expect(resaved.adjustments).toEqual([]);
    expect(resaved.totalAmount).toBe(saved.totalAmount);
  });

  it('코어 수 없음·기준 미만은 기준으로 (D1), 조작한 단가는 보정된다', async () => {
    const base = await saveQuote(ctx, {
      productFamily: model.family,
      lines: [line({ coreCount: undefined, unitPrice: model.unitPrice })],
    });
    expect(base.adjustments).toEqual([]);
    const [row] = await handle.db.select().from(quoteLines).where(eq(quoteLines.quoteId, base.id));
    expect(row!.options).toMatchObject({ core: { cores: 4 } });

    const below = await saveQuote(ctx, {
      productFamily: model.family,
      lines: [line({ coreCount: 2 })],
    });
    expect(below.adjustments).toMatchObject([
      { field: 'unitPrice', server: String(model.unitPrice) },
    ]);
  });

  it('N 품목: 코어 수를 보내도 버리고 options.core 없음 (기존 결과 불변)', async () => {
    const saved = await saveQuote(ctx, {
      productFamily: model.family,
      lines: [
        line({
          itemCode: normal.itemCode,
          name: normal.itemName,
          unitPrice: normal.unitPrice,
          coreCount: 8,
        }),
      ],
    });
    expect(saved.adjustments).toEqual([]);
    const [row] = await handle.db.select().from(quoteLines).where(eq(quoteLines.quoteId, saved.id));
    expect(row!.unitPrice).toBe(normal.unitPrice.toFixed(2));
    expect(row!.options).not.toHaveProperty('core');
  });

  it('장바구니 초안 복원(dry-run): 코어 수·스냅샷 유지, 변경 0건', async () => {
    const dry = await repriceDryRun(handle.db, [
      { ...line(), parts: [], bundles: [], groupItems: [] },
    ]);
    expect(dry).toMatchObject({ changed: 0, removed: 0 });
    expect(dry.lines[0]).toMatchObject({ coreCount: 6, unitPrice: model.unitPrice + 2 * PER_CORE });
    const restored = await resolveCartDraft(handle.db, { lines: [line()] });
    expect(restored.dirty).toBe(false);
    expect(restored.lines[0]).toMatchObject({ coreCount: 6, core: { cores: 6, baseCoreCount: 4 } });
  });
});
