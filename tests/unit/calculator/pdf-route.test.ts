// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs } from '@/db/schema';
import { applyPolicy } from '@/server/imports/apply-policy';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * GET /api/quotes/[id]/pdf (AC-70·72): 소유자 200 application/pdf(견적 번호 파일명, 렌더 시간 헤더, 감사 quote.pdf),
 * 타인 403 봉투 + 감사 denied + 무변경, ADMIN 200, 없는/잘못된 id 404, 비로그인 401.
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
}));

const { GET } = await import('@/app/api/quotes/[id]/pdf/route');
const { saveQuote } = await import('@/server/quotes/mutations');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let ownerId: string;
let otherId: string;
let adminId: string;
let quoteId: string;
let quoteNo: string;

const call = (id: string) =>
  GET(new Request(`http://localhost/api/quotes/${id}/pdf`), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  state.handle = await createTestDb();
  const handle = state.handle;
  ownerId = (await insertUser(handle, { email: 'owner@pentasecurity.com', role: 'USER' })).id;
  otherId = (await insertUser(handle, { email: 'other@pentasecurity.com', role: 'USER' })).id;
  adminId = (await insertUser(handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' })).id;
  const sales = await uploadFixture(handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
  const saved = await saveQuote(
    { handle, actor: { id: ownerId, label: 'owner', role: 'USER' }, meta: TEST_META },
    {
      productFamily: 'WAPPLES',
      lines: [
        {
          kind: 'item',
          itemCode: 'P10100015',
          name: 'Wapples-500 (H500 T2)',
          priceType: '정상판매',
          qty: 3,
          unitPrice: 12_000_000,
          currency: 'KRW',
          parts: [],
          bundles: [],
          groupItems: [],
          discountRate: 10,
        },
      ],
    },
  );
  quoteId = saved.id;
  quoteNo = saved.quoteNo;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
});

describe('GET /api/quotes/[id]/pdf', () => {
  it('AC-70: 소유자 → 200 application/pdf, 파일명 = 견적 번호, 렌더 시간 헤더, 감사 quote.pdf 성공', async () => {
    state.sessionUserId = ownerId;
    const response = await call(quoteId);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(`inline; filename="${quoteNo}.pdf"`);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(Number(response.headers.get('x-render-ms'))).toBeGreaterThanOrEqual(0);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(Number(response.headers.get('content-length'))).toBe(bytes.byteLength);
    expect((await auditByAction(state.handle!, 'quote.pdf')).at(-1)).toMatchObject({
      actorUserId: ownerId,
      targetId: quoteId,
      result: 'success',
      after: expect.objectContaining({ bytes: bytes.byteLength }) as unknown,
    });
  }, 60_000);

  it('AC-72: 타인 → 403 FORBIDDEN 봉투 + 감사 quote.pdf denied, 본문에 PDF 없음', async () => {
    state.sessionUserId = otherId;
    const audits = await state.handle!.db.$count(auditLogs);
    const response = await call(quoteId);
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '다른 사용자의 견적입니다' },
    });
    expect(await state.handle!.db.$count(auditLogs)).toBe(audits + 1);
    expect((await auditByAction(state.handle!, 'quote.pdf')).at(-1)).toMatchObject({
      actorUserId: otherId,
      targetId: quoteId,
      result: 'denied',
    });
  });

  it('ADMIN 은 남의 견적도 200; 없는 id·잘못된 id 는 404; 비로그인 401', async () => {
    state.sessionUserId = adminId;
    expect((await call(quoteId)).status).toBe(200);
    expect((await call('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await call('not-a-uuid')).status).toBe(404);
    state.sessionUserId = undefined;
    expect((await call(quoteId)).status).toBe(401);
  }, 60_000);
});
