// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { salesPrices, userDrafts, users, userViewStates } from '@/db/schema';
import { DRAFT_MAX_BYTES, parseDraft, type QuoteDraft } from '@/lib/page-state/drafts';

import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 입력 초안 (page-state-memory §2.1-1·§2.1-3·§2.4·§2.5·§2.6-3·§2.7) — PGlite.
 * 저장소: 화이트리스트·50KB·버전/스키마 불일치 폐기·알 수 없는 필드 버림·30일 만료 읽을 때 삭제·본인 행만·사용자 삭제 cascade.
 * 순매출 초안에 원가 필드 없음(값·DB·응답). 복원: 장바구니 최신가 갱신·판매 중지 제외 건수, 견적 단계별 재조회·멈춤.
 * 액션: user_id 는 세션에서만, 전역 초기화는 두 테이블을 모두 지운다.
 */
const state = vi.hoisted(() => ({
  handle: undefined as DbHandle | undefined,
  sessionUserId: undefined as string | undefined,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: async () => state.handle!.db,
  getDbHandle: async () => state.handle!,
}));
vi.mock('@/server/auth/auth', () => ({
  auth: async () => (state.sessionUserId ? { user: { id: state.sessionUserId } } : null),
}));
vi.mock('@/server/audit/request-meta', () => ({
  currentRequestMeta: async () => ({ ip: null, userAgent: 'vitest' }),
  currentRequestId: async () => null,
}));

const { readDraft, writeDraft, deleteDraft, clearSavedPageState } =
  await import('@/server/page-state/drafts');
const { writeViewQuery } = await import('@/server/page-state/store');
const { restoreDraft, restoreCalculatorDrafts, resolveQuoteDraft } =
  await import('@/server/page-state/draft-restore');
const { repriceDryRun } = await import('@/server/quotes/reprice');
const { saveDraftAction, deleteDraftAction, readDraftAction, clearSavedPageStateAction } =
  await import('@/features/page-state/draft-actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let userA: string;
let userB: string;

const db = () => state.handle!.db;
const rowsOf = (userId: string) =>
  db().select().from(userDrafts).where(eq(userDrafts.userId, userId));

const MARGIN = { sellingPrice: '1200000', quantity: '3', discountRate: '10' };

const QUOTE: QuoteDraft = {
  family: 'WAPPLES',
  priceType: '정상판매',
  mid: null,
  minor: null,
  itemCode: 'P100',
  unitPrice: 20_000_000,
  qty: 2,
  parts: [],
  bundles: [],
  rate: 12.5,
  target: '',
};

const line = (itemCode: string, unitPrice: number) => ({
  kind: 'item' as const,
  itemCode,
  name: `품목 ${itemCode}`,
  priceType: '정상판매',
  qty: 1,
  unitPrice,
  currency: 'KRW',
  parts: [],
  bundles: [],
  groupItems: [],
  discountRate: 0,
});

async function insertPrice(itemCode: string, unitPrice: string, status: '운영중' | '미사용') {
  await db()
    .insert(salesPrices)
    .values({
      sourceId: 1,
      productFamily: 'WAPPLES',
      itemCode,
      itemName: `품목 ${itemCode}`,
      unit: 'EA',
      priceType: '정상판매',
      priceCategory: '일반',
      currency: 'KRW',
      hasCorePrice: false,
      unitPrice,
      effectiveFrom: '2026-05-01',
      appliesToAllCustomers: true,
      isFinalSource: true,
      baseCoreCount: 0,
      unitPricePerCore: '0.00',
      customerCode: '0',
      source: 'erp',
      operationStatus: status,
    });
}

beforeAll(async () => {
  state.handle = await createTestDb();
  userA = (await insertUser(state.handle, { email: 'a@pentasecurity.com', role: 'USER' })).id;
  userB = (await insertUser(state.handle, { email: 'b@pentasecurity.com', role: 'USER' })).id;
  // P100: 20,000,000 → 지금은 21,000,000 (가격 변동) · P200: 그대로 · P300: 판매 중지(미사용)
  await insertPrice('P100', '21000000.00', '운영중');
  await insertPrice('P200', '500000.00', '운영중');
  await insertPrice('P300', '700000.00', '미사용');
});

beforeEach(async () => {
  await db().delete(userDrafts);
  await db().delete(userViewStates);
  state.sessionUserId = undefined;
  for (const id of [userA, userB]) invalidateSessionUser(id);
});

afterAll(async () => {
  await state.handle?.close();
});

describe('초안 검증 (lib)', () => {
  it('알 수 없는 필드는 버리고, 버전·형식이 다르면 폐기', () => {
    expect(parseDraft('margin', 1, { ...MARGIN, userId: userB, extra: 1 })).toEqual(MARGIN);
    expect(parseDraft('margin', 2, MARGIN)).toBeNull();
    expect(parseDraft('margin', 1, { ...MARGIN, quantity: 3 })).toBeNull();
    expect(parseDraft('quote', 1, { ...QUOTE, qty: 0 })).toBeNull();
    expect(parseDraft('cart', 1, { lines: [] })).toBeNull();
    // 화이트리스트 밖 키
    expect(parseDraft('settings' as never, 1, {})).toBeNull();
  });

  it('순매출 초안에는 원가 필드가 없다 (unitCost·miscCost 버림, §2.1-3)', () => {
    const parsed = parseDraft('margin', 1, { ...MARGIN, unitCost: '900000', miscCost: '5000' });
    expect(parsed).toEqual(MARGIN);
    expect(Object.keys(parsed!)).not.toContain('unitCost');
    expect(Object.keys(parsed!)).not.toContain('miscCost');
  });
});

describe('저장소 (user_drafts)', () => {
  it('draft_key 화이트리스트 밖은 쓰지도 읽지도 않는다', async () => {
    expect(await writeDraft(db(), userA, 'llm-key', 1, { apiKey: 'x' })).toBe('rejected');
    expect(await writeDraft(db(), userA, '__proto__', 1, {})).toBe('rejected');
    expect(await rowsOf(userA)).toEqual([]);
    await db()
      .insert(userDrafts)
      .values({ userId: userA, draftKey: 'policy-modal', version: 1, data: {} });
    expect(await readDraft(db(), userA, 'policy-modal' as never)).toBeNull();
  });

  it('저장·읽기(마지막 저장 우선), 알 수 없는 필드는 DB 에도 없다', async () => {
    expect(await writeDraft(db(), userA, 'margin', 1, { ...MARGIN, note: '<b>x</b>' })).toBe(
      'saved',
    );
    expect(await writeDraft(db(), userA, 'margin', 1, { ...MARGIN, quantity: '5' })).toBe('saved');
    const [row] = await rowsOf(userA);
    expect(row).toMatchObject({ draftKey: 'margin', version: 1 });
    expect(row!.data).toEqual({ ...MARGIN, quantity: '5' });
    expect((await readDraft(db(), userA, 'margin'))?.data).toEqual({ ...MARGIN, quantity: '5' });
  });

  it('스키마 불일치·버전 불일치 값은 저장하지 않고, 이미 있으면 읽을 때 지운다', async () => {
    expect(await writeDraft(db(), userA, 'margin', 99, MARGIN)).toBe('rejected');
    expect(await writeDraft(db(), userA, 'quote', 1, { family: 1 })).toBe('rejected');
    expect(await rowsOf(userA)).toEqual([]);
    await db()
      .insert(userDrafts)
      .values([
        { userId: userA, draftKey: 'margin', version: 0, data: MARGIN },
        { userId: userA, draftKey: 'quote', version: 1, data: { family: 'WAPPLES' } },
      ]);
    expect(await readDraft(db(), userA, 'margin')).toBeNull();
    expect(await readDraft(db(), userA, 'quote')).toBeNull();
    expect(await rowsOf(userA)).toEqual([]);
  });

  it('50KB 를 넘으면 저장하지 않는다', async () => {
    const big = Array.from({ length: 200 }, (_, index) => ({
      ...line(`P${index}`, 1),
      name: 'x'.repeat(300),
      parts: Array.from({ length: 3 }, (__, n) => ({
        itemCode: `Q${n}`,
        itemName: 'y'.repeat(300),
        unitPrice: 1,
      })),
    }));
    expect(JSON.stringify({ lines: big }).length).toBeGreaterThan(DRAFT_MAX_BYTES);
    expect(await writeDraft(db(), userA, 'cart', 1, { lines: big })).toBe('rejected');
    expect(await writeDraft(db(), userA, 'cart', 1, { lines: big.slice(0, 5) })).toBe('saved');
    // 변조로 커진 행은 읽을 때 버린다
    await db()
      .update(userDrafts)
      .set({ data: { lines: big } })
      .where(eq(userDrafts.userId, userA));
    expect(await readDraft(db(), userA, 'cart')).toBeNull();
    expect(await rowsOf(userA)).toEqual([]);
  });

  it('마지막 수정 후 30일이 지나면 복원하지 않고 읽을 때 지운다 (31일 = 만료, 29일 = 유지)', async () => {
    await writeDraft(db(), userA, 'margin', 1, MARGIN);
    await writeDraft(db(), userB, 'margin', 1, MARGIN);
    const now = new Date();
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    await db()
      .update(userDrafts)
      .set({ updatedAt: daysAgo(31) })
      .where(eq(userDrafts.userId, userA));
    await db()
      .update(userDrafts)
      .set({ updatedAt: daysAgo(29) })
      .where(eq(userDrafts.userId, userB));
    expect(await readDraft(db(), userA, 'margin', now)).toBeNull();
    expect(await rowsOf(userA)).toEqual([]);
    expect((await readDraft(db(), userB, 'margin', now))?.data).toEqual(MARGIN);
  });

  it('본인 행만 읽고 쓰고 지운다 · 사용자 삭제 시 cascade', async () => {
    await writeDraft(db(), userA, 'margin', 1, MARGIN);
    expect(await readDraft(db(), userB, 'margin')).toBeNull();
    await deleteDraft(db(), userB, 'margin');
    expect(await rowsOf(userA)).toHaveLength(1);

    const temp = await insertUser(state.handle!, { email: 'temp@pentasecurity.com' });
    await writeDraft(db(), temp.id, 'margin', 1, MARGIN);
    await db().delete(users).where(eq(users.id, temp.id));
    expect(await rowsOf(temp.id)).toEqual([]);
  });

  it('전역 초기화: 본인의 조회 상태·초안을 모두 지우고 다른 사용자는 그대로', async () => {
    await writeDraft(db(), userA, 'margin', 1, MARGIN);
    await writeDraft(db(), userA, 'cart', 1, { lines: [line('P100', 1)] });
    await writeViewQuery(db(), userA, 'pricing', 'q=wapples');
    await writeDraft(db(), userB, 'margin', 1, MARGIN);
    await writeViewQuery(db(), userB, 'pricing', 'q=b');
    expect(await clearSavedPageState(db(), userA)).toEqual({ viewStates: 1, drafts: 2 });
    expect(await rowsOf(userA)).toEqual([]);
    expect(
      await db().select().from(userViewStates).where(eq(userViewStates.userId, userA)),
    ).toEqual([]);
    expect(await rowsOf(userB)).toHaveLength(1);
    expect(
      await db().select().from(userViewStates).where(eq(userViewStates.userId, userB)),
    ).toHaveLength(1);
  });
});

describe('복원 — 최신가 갱신 (§2.5)', () => {
  it('reprice dry-run: 바뀐 가격은 갱신해 세고, 판매 중지·삭제 품목 라인은 제외해 센다', async () => {
    const result = await repriceDryRun(db(), [
      line('P100', 20_000_000),
      line('P200', 500_000),
      line('P300', 700_000),
      line('GONE', 1),
    ]);
    expect(result.changed).toBe(1);
    expect(result.removed).toBe(2);
    expect(result.lines.map((entry) => [entry.itemCode, entry.unitPrice])).toEqual([
      ['P100', 21_000_000],
      ['P200', 500_000],
    ]);
  });

  it('장바구니 초안 복원 = 최신가 라인 + 안내 2줄 + 다시 저장 표시(dirty)', async () => {
    await writeDraft(db(), userA, 'cart', 1, {
      lines: [line('P100', 20_000_000), line('P200', 500_000), line('P300', 700_000)],
    });
    const restored = await restoreDraft(db(), userA, 'cart');
    expect(restored?.lines.map((entry) => entry.unitPrice)).toEqual([21_000_000, 500_000]);
    expect(restored?.notices).toEqual([
      '가격이 바뀐 품목 1건을 최신가로 갱신했습니다',
      '1건은 더 이상 판매하지 않아 제외했습니다',
    ]);
    expect(restored?.dirty).toBe(true);
    expect(restored?.restoredAt).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('가격 그대로면 안내 없음', async () => {
    await writeDraft(db(), userA, 'cart', 1, { lines: [line('P200', 500_000)] });
    const restored = await restoreDraft(db(), userA, 'cart');
    expect(restored).toMatchObject({ notices: [], dirty: false });
  });
});

describe('복원 — 견적 입력 단계별 재조회 (§2.4-3)', () => {
  it('제품군 → 단가유형 → 품목을 다시 조회해 최신 행으로 선택, 가격이 바뀌면 안내', async () => {
    const resolved = await resolveQuoteDraft(db(), QUOTE);
    expect(resolved?.form).toMatchObject({
      family: 'WAPPLES',
      priceType: '정상판매',
      qty: 2,
      rate: 12.5,
      selected: { itemCode: 'P100', unitPrice: '21000000.00' },
    });
    expect(resolved?.notices).toEqual(['가격이 바뀐 품목 1건을 최신가로 갱신했습니다']);
  });

  it('단가유형이 없어지면 제품군 단계에서 멈추고 안내', async () => {
    const resolved = await resolveQuoteDraft(db(), { ...QUOTE, priceType: '사라진유형' });
    expect(resolved?.form).toMatchObject({
      family: 'WAPPLES',
      priceType: '정상판매',
      selected: null,
    });
    expect(resolved?.notices[0]).toContain('제품군 단계까지만 복원했습니다');
  });

  it('분류가 없어지면 단가 유형 단계에서 멈춘다', async () => {
    const resolved = await resolveQuoteDraft(db(), { ...QUOTE, mid: '없는 중분류' });
    expect(resolved?.form).toMatchObject({ priceType: '정상판매', mid: null, selected: null });
    expect(resolved?.notices[0]).toContain('단가 유형 단계까지만 복원했습니다');
  });

  it('품목이 없어지면(판매 중지) 분류 단계에서 멈추고 수량·할인은 복원하지 않는다', async () => {
    const resolved = await resolveQuoteDraft(db(), { ...QUOTE, itemCode: 'P300' });
    expect(resolved?.form).toMatchObject({ selected: null, qty: 1, rate: 0 });
    expect(resolved?.notices[0]).toContain('분류 단계까지만 복원했습니다');
    expect(resolved?.dirty).toBe(true);
  });

  it('없어진 파츠·결합형은 빼고 안내 · 제품군이 없어지면 null', async () => {
    const resolved = await resolveQuoteDraft(db(), {
      ...QUOTE,
      unitPrice: 21_000_000,
      parts: ['X1'],
    });
    expect(resolved?.form.parts).toEqual([]);
    expect(resolved?.notices).toEqual(['1건은 더 이상 판매하지 않아 제외했습니다']);
    expect(await resolveQuoteDraft(db(), { ...QUOTE, family: 'NOPE' })).toBeNull();
  });

  it('계산기 RSC 복원: 페이지 제품군 목록 기준, 챗봇 링크 진입이면 견적 입력 초안을 읽지 않는다', async () => {
    await writeDraft(db(), userA, 'quote', 1, QUOTE);
    await writeDraft(db(), userA, 'margin', 1, MARGIN);
    const preload = [
      {
        family: 'WAPPLES',
        priceTypes: [{ priceType: '정상판매', count: 2 }],
        categories: { majors: ['WAPPLES'], mids: [], minorsByMid: {}, hasMaster: false },
        groups: [],
        hardware: [],
      },
    ];
    const drafts = await restoreCalculatorDrafts(db(), userA, { preload });
    expect(drafts.quote?.form.selected?.itemCode).toBe('P100');
    expect(drafts.margin?.values).toEqual(MARGIN);
    expect(drafts.cart).toBeUndefined();
    const skipped = await restoreCalculatorDrafts(db(), userA, { preload, skipQuote: true });
    expect(skipped.quote).toBeUndefined();
    // 다른 사용자에게는 없음
    expect(await restoreCalculatorDrafts(db(), userB, { preload })).toEqual({});
  });
});

describe('Server Actions', () => {
  it('비로그인은 거부, 행 없음', async () => {
    const result = await saveDraftAction({ draftKey: 'margin', version: 1, data: MARGIN });
    expect(result.ok).toBe(false);
    expect(await db().select().from(userDrafts)).toEqual([]);
  });

  it('user_id 는 세션에서만 — 입력의 userId 는 버려지고 본인 행에 저장된다', async () => {
    state.sessionUserId = userA;
    const result = await saveDraftAction({
      draftKey: 'margin',
      version: 1,
      data: { ...MARGIN, userId: userB },
      userId: userB,
    } as never);
    expect(result).toEqual({ ok: true, data: { status: 'saved' } });
    expect(await rowsOf(userB)).toEqual([]);
    expect((await rowsOf(userA))[0]!.data).toEqual(MARGIN);
  });

  it('화이트리스트 밖 키는 VALIDATION · 큰 입력은 거부', async () => {
    state.sessionUserId = userA;
    const bad = await saveDraftAction({ draftKey: 'admin-policy', version: 1, data: {} });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('VALIDATION');
    const huge = await saveDraftAction({
      draftKey: 'margin',
      version: 1,
      data: { ...MARGIN, pad: 'x'.repeat(DRAFT_MAX_BYTES * 5) },
    });
    expect(huge.ok).toBe(false);
  });

  it('순매출 원가 입력은 DB 초안·다시 읽기 응답 어디에도 없다 (단위 + DB 조회)', async () => {
    state.sessionUserId = userA;
    await saveDraftAction({
      draftKey: 'margin',
      version: 1,
      data: { ...MARGIN, unitCost: '987654', miscCost: '123456' },
    });
    const raw = await state.handle!.db.execute(
      sql`select data::text as data from user_drafts where user_id = ${userA}`,
    );
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/unitCost|miscCost|987654|123456/);
    const read = await readDraftAction({ draftKey: 'margin' });
    expect(read.ok).toBe(true);
    expect(JSON.stringify(read)).not.toMatch(/unitCost|miscCost|987654|123456/);
    if (read.ok) expect(read.data?.values).toEqual(MARGIN);
  });

  it('삭제 · 다시 읽기는 본인 초안만', async () => {
    await writeDraft(db(), userB, 'margin', 1, MARGIN);
    state.sessionUserId = userA;
    expect(await readDraftAction({ draftKey: 'margin' })).toEqual({ ok: true, data: null });
    await deleteDraftAction({ draftKey: 'margin' });
    expect(await rowsOf(userB)).toHaveLength(1);
    state.sessionUserId = userB;
    await deleteDraftAction({ draftKey: 'margin' });
    expect(await rowsOf(userB)).toEqual([]);
  });

  it('전역 초기화 액션: 세션 사용자의 두 테이블을 지운다', async () => {
    await writeDraft(db(), userA, 'margin', 1, MARGIN);
    await writeViewQuery(db(), userA, 'pricing', 'q=a');
    await writeDraft(db(), userB, 'margin', 1, MARGIN);
    state.sessionUserId = userA;
    expect(await clearSavedPageStateAction()).toEqual({
      ok: true,
      data: { viewStates: 1, drafts: 1 },
    });
    expect(await rowsOf(userA)).toEqual([]);
    expect(await rowsOf(userB)).toHaveLength(1);
  });
});
