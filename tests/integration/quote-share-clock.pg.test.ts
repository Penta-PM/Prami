import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { AppError } from '@/lib/result';
import { applyPolicy } from '@/server/imports/apply-policy';
import { queryRows } from '@/server/imports/sql-rows';
import { saveQuote, type QuotesContext } from '@/server/quotes/mutations';
import {
  createQuoteShare,
  findSharedQuote,
  listQuoteShares,
  revokeQuoteShare,
} from '@/server/quotes/shares';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../helpers/imports';

/**
 * PRAMI-003 AC-371 (AC-71 간헐 실패 원인) — 실제 PostgreSQL 16. 앱 시계가 DB 시계보다 5초 앞선 상태(`Date` 만 가짜)에서
 * 폐기 직후 공개 조회가 null(404)이어야 한다. 폐기 시각을 앱 시계로 쓰던 이전 코드는 DB `now()` 비교에서 링크가
 * 5초 동안 살아 있어 이 테스트가 실패한다.
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);
const APP_CLOCK_AHEAD_MS = 5_000;

/** 판매단가 픽스처 적용 — 같은 DB 에서 다시 실행하면 이미 적용된 배치(CONFLICT)를 그대로 쓴다 */
async function ensureSalesPrices(handle: DbHandle) {
  try {
    const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
    await applyPolicy(
      { handle, actor: TEST_ACTOR, meta: TEST_META },
      { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
    );
  } catch (error) {
    const applied =
      error instanceof AppError &&
      error.code === 'CONFLICT' &&
      (error.details as { status?: unknown } | undefined)?.status === 'applied';
    if (!applied) throw error;
  }
}

describe.skipIf(!enabled)('공유 폐기 시계 통일 (AC-371, PostgreSQL)', () => {
  let handle: DbHandle;
  let owner: QuotesContext;
  let quoteId: string;

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
    const [user] = await queryRows<{ id: string; email: string }>(
      handle.db,
      sql`insert into users (email, name, created_via)
          values (${`share-clock-${Date.now()}@pentasecurity.com`}, 'share-clock', 'admin')
          returning id, email`,
    );
    owner = {
      handle,
      actor: { id: user!.id, label: user!.email, role: 'USER' },
      meta: TEST_META,
    };
    await ensureSalesPrices(handle);
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
  }, 120_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('앱 시계 +5초에서 폐기 → 즉시 findSharedQuote null, 목록 비활성, 폐기 시각 = DB 시계', async () => {
    const share = await createQuoteShare(owner, { quoteId });
    expect(await findSharedQuote(handle.db, share.token)).not.toBeNull();

    // 앱(Node) 시계만 5초 앞으로 — DB(Postgres) 시계는 그대로
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + APP_CLOCK_AHEAD_MS);

    const revoked = await revokeQuoteShare(owner, { shareId: share.id });
    expect(revoked.isActive).toBe(false);
    expect(await findSharedQuote(handle.db, share.token)).toBeNull();
    const listed = (await listQuoteShares(owner, { quoteId })).find((row) => row.id === share.id);
    expect(listed?.isActive).toBe(false);

    const [db] = await queryRows<{ lag_ms: number }>(
      handle.db,
      sql`select extract(epoch from (now() - expires_at)) * 1000 as lag_ms
          from quote_shares where id = ${share.id}`,
    );
    // 저장된 폐기 시각이 앱 시계(+5초)가 아니라 DB 시계다 — DB now() 이하
    expect(Number(db!.lag_ms)).toBeGreaterThanOrEqual(0);
    expect(new Date(revoked.expiresAt).getTime()).toBeLessThan(Date.now() - APP_CLOCK_AHEAD_MS / 2);
  });
});
