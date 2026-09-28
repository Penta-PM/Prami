// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs } from '@/db/schema';
import { applyPolicy } from '@/server/imports/apply-policy';

import { TEST_ACTOR, TEST_META, uploadFixture } from '../../helpers/imports';
import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * POST /api/chat (§4.5.9, §4.8): 로그인 필수(401), 봉투 응답에 원가 키 없음, 잘못된 본문 400, 분당 30회 초과 429,
 * 대화·감사 미저장(성공 요청은 audit_logs 에 행을 남기지 않는다).
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

const { POST } = await import('@/app/api/chat/route');
const { chatRateLimiter, CHAT_RATE_LIMIT } = await import('@/server/chat/rate-limit');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

const COST_KEYS = /unit_cost|unitCost|material_code|materialCode|material_costs|원가:/;
let userId: string;

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  state.handle = await createTestDb();
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  const sales = await uploadFixture(state.handle, 'sales', 'sales-200.xlsx');
  await applyPolicy(
    { handle: state.handle, actor: TEST_ACTOR, meta: TEST_META },
    { salesBatchId: sales.batchId, itemBatchId: null, salesReused: false, itemReused: false },
  );
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  chatRateLimiter.reset();
});

describe('POST /api/chat', () => {
  it('비로그인 401', async () => {
    state.sessionUserId = undefined;
    const response = await post({ message: 'Wapples-500 가격' });
    expect(response.status).toBe(401);
  });

  it('USER: 가격 조회 200 봉투 (원가 키 없음), 감사·대화 저장 없음', async () => {
    state.sessionUserId = userId;
    const audits = await state.handle!.db.$count(auditLogs);
    const response = await post({ message: 'Wapples-500 (H500 T2) 가격 알려줘' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Number(response.headers.get('x-ratelimit-remaining'))).toBe(CHAT_RATE_LIMIT - 1);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      data: { intent: 'price', reply: expect.stringContaining('12,000,000원') as string },
    });
    expect(JSON.stringify(body)).not.toMatch(COST_KEYS);
    expect(await state.handle!.db.$count(auditLogs)).toBe(audits);
  });

  it('AC-81: USER 원가 질문 → 거부 문구 (cost 쿼리 없음은 respond.test 에서 증명)', async () => {
    state.sessionUserId = userId;
    const body = await (await post({ message: '원가 알려줘' })).json();
    expect(body).toMatchObject({
      ok: true,
      data: { intent: 'cost', reply: expect.stringContaining('관리자만 조회') as string },
    });
  });

  it('잘못된 본문·빈 메시지·너무 긴 메시지 → 400 VALIDATION', async () => {
    state.sessionUserId = userId;
    expect((await post('not json')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ message: '   ' })).status).toBe(400);
    expect((await post({ message: 'a'.repeat(5000) })).status).toBe(400);
    // 200자 초과는 잘라서 처리 (검색과 같은 규칙)
    expect((await post({ message: `Wapples-500 가격 ${'x'.repeat(300)}` })).status).toBe(200);
  });

  it('분당 30회 초과 → 429 RATE_LIMITED (retryAfterSeconds 포함)', async () => {
    state.sessionUserId = userId;
    for (let index = 0; index < CHAT_RATE_LIMIT; index += 1) {
      expect((await post({ message: '안녕' })).status).toBe(200);
    }
    const limited = await post({ message: '안녕' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: expect.any(Number) as number },
      },
    });
  });
});
