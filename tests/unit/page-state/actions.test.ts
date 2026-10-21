// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, userViewStates } from '@/db/schema';

import { createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조회 상태 저장 Server Actions (page-state-memory §2.2-3·§2.7-2): user_id 는 세션에서만, 화이트리스트·권한·정규화·2KB,
 * '필터 초기화' 빈 상태 저장, 다른 사용자 행 쓰기 불가.
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

const { saveViewStateAction, saveViewScrollAction } = await import('@/features/page-state/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let userA: string;
let userB: string;
let admin: string;

const rowsOf = (userId: string) =>
  state.handle!.db.select().from(userViewStates).where(eq(userViewStates.userId, userId));

beforeAll(async () => {
  state.handle = await createTestDb();
  userA = (await insertUser(state.handle, { email: 'a@pentasecurity.com', role: 'USER' })).id;
  userB = (await insertUser(state.handle, { email: 'b@pentasecurity.com', role: 'USER' })).id;
  admin = (await insertUser(state.handle, { email: 'adm@pentasecurity.com', role: 'ADMIN' })).id;
});

beforeEach(async () => {
  await state.handle!.db.delete(userViewStates);
  state.sessionUserId = undefined;
  for (const id of [userA, userB, admin]) invalidateSessionUser(id);
});

afterAll(async () => {
  await state.handle?.close();
});

describe('saveViewStateAction', () => {
  it('비로그인은 UNAUTHENTICATED, 행 없음', async () => {
    const result = await saveViewStateAction({ pageKey: 'pricing', query: 'q=a' });
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(await state.handle!.db.select().from(userViewStates)).toEqual([]);
  });

  it('세션 사용자 본인 행에 정규화 쿼리를 저장한다 — 입력의 userId 는 무시', async () => {
    state.sessionUserId = userA;
    const result = await saveViewStateAction({
      pageKey: 'pricing',
      query: 'sort=itemName&dir=desc&q=abc&junk=1',
      userId: userB,
    } as { pageKey: string; query: string });
    expect(result).toEqual({ ok: true, data: { status: 'saved' } });
    expect((await rowsOf(userA)).map((row) => row.query)).toEqual(['q=abc&sort=itemName&dir=desc']);
    expect(await rowsOf(userB)).toEqual([]);
  });

  it('다른 사용자의 행은 쓸 수 없다 — B 의 기존 행은 그대로', async () => {
    await state
      .handle!.db.insert(userViewStates)
      .values({ userId: userB, pageKey: 'pricing', query: 'q=b' });
    state.sessionUserId = userA;
    await saveViewStateAction({ pageKey: 'pricing', query: 'q=a' });
    expect((await rowsOf(userB)).map((row) => row.query)).toEqual(['q=b']);
    expect((await rowsOf(userA)).map((row) => row.query)).toEqual(['q=a']);
  });

  it("'필터 초기화' = 빈 쿼리 저장 — 이전 조건을 덮는다", async () => {
    state.sessionUserId = userA;
    await saveViewStateAction({ pageKey: 'pricing', query: 'q=old&page=4' });
    await saveViewStateAction({ pageKey: 'pricing', query: '' });
    expect((await rowsOf(userA)).map((row) => row.query)).toEqual(['']);
  });

  it('화이트리스트 밖 page_key 는 VALIDATION (저장 거부)', async () => {
    state.sessionUserId = admin;
    for (const pageKey of ['settings', 'search', '', 'admin-costs-links'])
      expect(await saveViewStateAction({ pageKey, query: 'q=a' })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    expect(await rowsOf(admin)).toEqual([]);
  });

  it('그 화면 권한이 없으면 FORBIDDEN + 감사 denied, 행 없음', async () => {
    state.sessionUserId = userA;
    const result = await saveViewStateAction({ pageKey: 'admin-users', query: 'f.name.has=a' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await rowsOf(userA)).toEqual([]);
    const denied = await state
      .handle!.db.select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'view_state.save'));
    expect(denied.map((row) => row.result)).toEqual(['denied']);
  });

  it('정규화 후 2KB 를 넘으면 저장하지 않는다(rejected), 원문이 지나치게 길면 VALIDATION', async () => {
    state.sessionUserId = admin;
    // 열 필터 3개 × 값 100자(한글 — URL 인코딩 9바이트) → 정규화해도 2KB 초과
    const cols = ['name', 'email', 'department'];
    const query = cols.map((col) => `f.${col}.has=${'가'.repeat(100)}`).join('&');
    const result = await saveViewStateAction({
      pageKey: 'admin-users',
      query: new URLSearchParams(query).toString(),
    });
    expect(result).toEqual({ ok: true, data: { status: 'rejected' } });
    expect(await rowsOf(admin)).toEqual([]);
    expect(
      await saveViewStateAction({ pageKey: 'admin-users', query: 'x'.repeat(10_000) }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});

describe('saveViewScrollAction', () => {
  it('정규화한 조건과 함께 {query, top} 을 저장한다 (정수로 반올림)', async () => {
    state.sessionUserId = userA;
    await saveViewStateAction({ pageKey: 'pricing', query: 'q=abc' });
    const result = await saveViewScrollAction({ pageKey: 'pricing', query: 'q=+abc+', top: 321.6 });
    expect(result).toEqual({ ok: true, data: { status: 'saved' } });
    const [row] = await rowsOf(userA);
    expect(row).toMatchObject({ query: 'q=abc', scroll: { query: 'q=abc', top: 322 } });
  });

  it('잘못된 top·page_key 는 VALIDATION', async () => {
    state.sessionUserId = userA;
    for (const input of [
      { pageKey: 'pricing', query: '', top: -5 },
      { pageKey: 'pricing', query: '', top: Number.NaN },
      { pageKey: 'nope', query: '', top: 1 },
    ])
      expect(await saveViewScrollAction(input)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    expect(await rowsOf(userA)).toEqual([]);
  });
});
