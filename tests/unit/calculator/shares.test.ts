// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { quoteShares, quotes } from '@/db/schema';
import { AppError } from '@/lib/result';
import { applyPolicy } from '@/server/imports/apply-policy';
import { saveQuote, type QuotesContext } from '@/server/quotes/mutations';
import {
  createQuoteShare,
  findSharedQuote,
  listQuoteShares,
  revokeQuoteShare,
  SHARE_TOKEN_RE,
} from '@/server/quotes/shares';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 견적 공유 (§4.3.8 quote_shares, §4.5.8, AC-71, Q-13): 32바이트 토큰·만료 기본 30일, 살아 있는 토큰만 문서 반환,
 * 폐기·만료·삭제 → null(404), 타인 견적은 FORBIDDEN + 감사 denied, 응답에 원가 없음, 감사 quote.share.create/revoke.
 */
let handle: DbHandle;
let owner: QuotesContext;
let other: QuotesContext;
let admin: QuotesContext;
let quoteId: string;
const DAY = 24 * 60 * 60 * 1000;
const COST_KEYS = /unit_cost|unitCost|material_code|materialCode|material_costs|원가/;

const ctxFor = (user: { id: string; email: string; role: 'USER' | 'ADMIN' }): QuotesContext => ({
  handle,
  actor: { id: user.id, label: user.email, role: user.role },
  meta: TEST_META,
});

beforeAll(async () => {
  handle = await createTestDb();
  owner = ctxFor(await insertUser(handle, { email: 'owner@pentasecurity.com', role: 'USER' }));
  other = ctxFor(await insertUser(handle, { email: 'other@pentasecurity.com', role: 'USER' }));
  admin = ctxFor(await insertUser(handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }));
  const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
  const saved = await saveQuote(owner, {
    productFamily: 'WAPPLES',
    lines: [
      {
        kind: 'item',
        itemCode: 'P10100015',
        name: 'Wapples-500 (H500 T2)',
        priceType: '정상판매',
        qty: 1,
        unitPrice: 12_000_000,
        currency: 'KRW',
        parts: [],
        bundles: [],
        groupItems: [],
        discountRate: 0,
      },
    ],
  });
  quoteId = saved.id;
});

afterAll(async () => {
  await handle.close();
});

describe('createQuoteShare / findSharedQuote', () => {
  it('토큰 = hex 64자(32바이트), 만료 기본 30일, 감사 quote.share.create (토큰은 감사에 남기지 않음)', async () => {
    const before = Date.now();
    const share = await createQuoteShare(owner, { quoteId });
    expect(share.token).toMatch(SHARE_TOKEN_RE);
    expect(share.path).toBe(`/share/quotes/${share.token}`);
    expect(share.isActive).toBe(true);
    const expires = new Date(share.expiresAt).getTime();
    expect(expires - before).toBeGreaterThan(29.9 * DAY);
    expect(expires - before).toBeLessThan(30.1 * DAY);
    const [audit] = await auditByAction(handle, 'quote.share.create');
    expect(audit).toMatchObject({ targetId: quoteId, result: 'success' });
    expect(JSON.stringify(audit)).not.toContain(share.token);
  });

  it('AC-71: 살아 있는 토큰이면 문서(원가 없음), 잘못된 형식·없는 토큰은 null', async () => {
    const share = await createQuoteShare(owner, { quoteId, expiresInDays: 7 });
    const found = await findSharedQuote(handle.db, share.token);
    expect(found?.document).toMatchObject({
      id: quoteId,
      quoteNo: expect.stringMatching(/^Q-\d{4}-0001$/) as string,
      totalAmount: '12000000',
      currency: 'KRW',
      ownerName: 'owner',
    });
    expect(found?.document.lines[0]).toMatchObject({ itemCode: 'P10100015', qty: 1 });
    expect(JSON.stringify(found)).not.toMatch(COST_KEYS);
    expect(await findSharedQuote(handle.db, 'not-a-token')).toBeNull();
    expect(await findSharedQuote(handle.db, 'f'.repeat(64))).toBeNull();
  });

  it('폐기하면 즉시 null, 목록에는 비활성으로 남고 감사 quote.share.revoke; 두 번 폐기는 CONFLICT', async () => {
    const share = await createQuoteShare(owner, { quoteId });
    expect(await findSharedQuote(handle.db, share.token)).not.toBeNull();
    const revoked = await revokeQuoteShare(owner, { shareId: share.id });
    expect(revoked.isActive).toBe(false);
    expect(await findSharedQuote(handle.db, share.token)).toBeNull();
    const list = await listQuoteShares(owner, { quoteId });
    expect(list.find((entry) => entry.id === share.id)?.isActive).toBe(false);
    expect((await auditByAction(handle, 'quote.share.revoke')).at(-1)).toMatchObject({
      targetId: quoteId,
      result: 'success',
    });
    await expect(revokeQuoteShare(owner, { shareId: share.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('만료된 토큰·삭제된 견적은 null', async () => {
    const share = await createQuoteShare(owner, { quoteId, expiresInDays: 1 });
    await handle.db
      .update(quoteShares)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(quoteShares.id, share.id));
    expect(await findSharedQuote(handle.db, share.token)).toBeNull();

    const alive = await createQuoteShare(owner, { quoteId });
    await handle.db.update(quotes).set({ deletedAt: new Date() }).where(eq(quotes.id, quoteId));
    expect(await findSharedQuote(handle.db, alive.token)).toBeNull();
    await handle.db.update(quotes).set({ deletedAt: null }).where(eq(quotes.id, quoteId));
    expect(await findSharedQuote(handle.db, alive.token)).not.toBeNull();
  });

  it('§4.7.1: 타인 견적의 공유 생성·목록·폐기는 FORBIDDEN + 무변경 + 감사 denied; ADMIN 은 가능', async () => {
    const countBefore = await handle.db.$count(quoteShares);
    const denied = await createQuoteShare(other, { quoteId }).catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(AppError);
    expect((denied as AppError).code).toBe('FORBIDDEN');
    expect(await handle.db.$count(quoteShares)).toBe(countBefore);
    expect((await auditByAction(handle, 'quote.share.create')).at(-1)).toMatchObject({
      actorUserId: other.actor.id,
      result: 'denied',
    });
    await expect(listQuoteShares(other, { quoteId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const mine = await listQuoteShares(owner, { quoteId });
    const active = mine.find((entry) => entry.isActive)!;
    await expect(revokeQuoteShare(other, { shareId: active.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await auditByAction(handle, 'quote.share.revoke')).at(-1)).toMatchObject({
      actorUserId: other.actor.id,
      result: 'denied',
    });
    const byAdmin = await createQuoteShare(admin, { quoteId, expiresInDays: 365 });
    expect(byAdmin.isActive).toBe(true);
    expect((await revokeQuoteShare(admin, { shareId: byAdmin.id })).isActive).toBe(false);
  });

  it('검증: 만료일 범위 1~365, 없는 견적·없는 링크는 NOT_FOUND', async () => {
    await expect(createQuoteShare(owner, { quoteId, expiresInDays: 0 })).rejects.toMatchObject({
      name: 'ZodError',
    });
    await expect(createQuoteShare(owner, { quoteId, expiresInDays: 366 })).rejects.toMatchObject({
      name: 'ZodError',
    });
    await expect(
      createQuoteShare(owner, { quoteId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      revokeQuoteShare(owner, { shareId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('AC-371 시계 통일 — 폐기·조회 경로는 DB 시계(now())만', () => {
  const source = readFileSync(join(process.cwd(), 'src/server/quotes/shares.ts'), 'utf8');
  /** `export async function <name>(` 부터 다음 최상위 선언 전까지 */
  const bodyOf = (name: string) => {
    const start = source.indexOf(`export async function ${name}(`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const rest = source.slice(start + 1);
    const next = rest.search(/\n(export |function |const |type )/);
    return next < 0 ? rest : rest.slice(0, next);
  };

  it.each(['revokeQuoteShare', 'listQuoteShares', 'findSharedQuote'])(
    '%s 에 앱 시계(new Date()·Date.now()) 비교가 없다',
    (name) => {
      const body = bodyOf(name);
      expect(body).not.toMatch(/new Date\(|Date\.now\(/);
      expect(body).toMatch(/now\(\)|isActiveSql/);
    },
  );
});
