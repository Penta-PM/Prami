// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { procurementAppState, procurementBidKeywords } from '@/db/schema/procurement';
import type { ActionResult } from '@/lib/result';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 조달이 통합 UI-8 키워드 관리 — Server Action·서버 쓰기 (PGlite, 합성 키워드만).
 * 권한 매트릭스(비로그인·USER·ADMIN), 추가·삭제와 감사(procurement.keyword.add|delete)의 같은 트랜잭션(감사 실패 → 변경 롤백),
 * 입력 검증, 그룹 안 중복, 동시 편집("이미 처리됨" CONFLICT).
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
  currentRequestMeta: async () => ({ ip: '198.51.100.8', userAgent: 'vitest' }),
  currentRequestId: async () => null,
}));

const { addBidKeywordAction, deleteBidKeywordAction } =
  await import('@/features/procurement/admin/keywords/actions');
const { addBidKeyword, deleteBidKeyword, getBidKeywordBoard } =
  await import('@/server/procurement/keywords');
const { procurementAccessForTests } = await import('@/server/procurement/access-token');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

const ADMIN_EMAIL = 'kw-admin@pentasecurity.com';
let adminId: string;
let userId: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: ADMIN_EMAIL, role: 'ADMIN' })).id;
  userId = (await insertUser(state.handle, { email: 'kw-user@pentasecurity.com', role: 'USER' }))
    .id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(async () => {
  invalidateSessionUser();
  state.sessionUserId = undefined;
  await state.handle!.db.delete(procurementBidKeywords);
});

const db = () => state.handle!.db;
const keywordRows = () => db().select().from(procurementBidKeywords);
const audits = async (action: string) => auditByAction(state.handle!, action);

function expectError<T>(result: ActionResult<T>, code: string) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.error.code).toBe(code);
  return result.error;
}

function expectOk<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`실패: ${result.error.code} ${result.error.message}`);
  return result.data;
}

async function seed(product: string, keyword: string, createdBy: string | null = '기본') {
  const [row] = await db()
    .insert(procurementBidKeywords)
    .values({ product, keyword, createdBy })
    .returning();
  return row!;
}

describe('권한 매트릭스', () => {
  it('비로그인: 추가·삭제 모두 UNAUTHENTICATED, 변경·감사 없음', async () => {
    const row = await seed('WAPPLES', '가상 키워드');
    expectError(
      await addBidKeywordAction({ product: 'WAPPLES', keyword: '새 키워드' }),
      'UNAUTHENTICATED',
    );
    expectError(await deleteBidKeywordAction({ id: row.id }), 'UNAUTHENTICATED');
    expect((await keywordRows()).map((r) => r.keyword)).toEqual(['가상 키워드']);
    expect(await audits('procurement.keyword.add')).toHaveLength(0);
  });

  it('USER: FORBIDDEN + 시도한 행위 키로 감사 denied, 변경 없음', async () => {
    state.sessionUserId = userId;
    const row = await seed('D.AMO', '가상 암호화');
    const deniedBefore = {
      add: (await audits('procurement.keyword.add')).length,
      del: (await audits('procurement.keyword.delete')).length,
    };
    expectError(await addBidKeywordAction({ product: 'D.AMO', keyword: '새 키워드' }), 'FORBIDDEN');
    expectError(await deleteBidKeywordAction({ id: row.id }), 'FORBIDDEN');

    const add = await audits('procurement.keyword.add');
    const del = await audits('procurement.keyword.delete');
    expect(add).toHaveLength(deniedBefore.add + 1);
    expect(del).toHaveLength(deniedBefore.del + 1);
    for (const denied of [add.at(-1), del.at(-1)]) {
      expect(denied).toMatchObject({ actorUserId: userId, result: 'denied' });
    }
    expect(add.at(-1)).toMatchObject({ targetId: 'action:addBidKeyword' });
    expect((await keywordRows()).map((r) => r.keyword)).toEqual(['가상 암호화']);
  });

  it('조회(write 토큰) — 키워드(기본은 addedBy null, 직접 추가는 메일 앞부분) + 마지막 확인 시각', async () => {
    state.sessionUserId = adminId;
    await seed('WAPPLES', '가상 방화벽');
    await seed('제외', '가상 제외어', 'someone@example.invalid');
    await db()
      .insert(procurementAppState)
      .values({ key: 'bids.last_checked', value: '2026-10-20T01:30:00.000Z' })
      .onConflictDoUpdate({
        target: procurementAppState.key,
        set: { value: '2026-10-20T01:30:00.000Z' },
      });
    const writeAccess = procurementAccessForTests({ id: adminId, email: ADMIN_EMAIL }, 'write');
    const board = await getBidKeywordBoard(writeAccess, db());
    expect(board.lastCheckedAt).toBe('2026-10-20T01:30:00.000Z');
    expect(
      board.keywords.map(({ product, keyword, addedBy }) => ({ product, keyword, addedBy })),
    ).toEqual([
      { product: 'WAPPLES', keyword: '가상 방화벽', addedBy: null },
      { product: '제외', keyword: '가상 제외어', addedBy: 'someone' },
    ]);
    await db().delete(procurementAppState).where(eq(procurementAppState.key, 'bids.last_checked'));
    expect((await getBidKeywordBoard(writeAccess, db())).lastCheckedAt).toBeNull();
    // read 토큰(USER)으로는 관리 목록을 읽을 수 없다
    await expect(getBidKeywordBoard(procurementAccessForTests(), db())).rejects.toThrow(
      'write 범위',
    );
  });
});

describe('추가·삭제 + 감사 (같은 트랜잭션)', () => {
  it('추가: 정규화한 값 저장(created_by = 사용자 메일) + 감사 procurement.keyword.add', async () => {
    state.sessionUserId = adminId;
    const before = (await audits('procurement.keyword.add')).length;
    const added = expectOk(
      await addBidKeywordAction({ product: 'iSIGN', keyword: '  가상   통합인증 ' }),
    );
    expect(added).toMatchObject({
      product: 'iSIGN',
      keyword: '가상 통합인증',
      addedBy: 'kw-admin',
    });
    const [row] = await keywordRows();
    expect(row).toMatchObject({ id: added.id, keyword: '가상 통합인증', createdBy: ADMIN_EMAIL });
    const log = await audits('procurement.keyword.add');
    expect(log).toHaveLength(before + 1);
    expect(log.at(-1)).toMatchObject({
      actorUserId: adminId,
      actorLabel: ADMIN_EMAIL,
      result: 'success',
      targetType: 'procurement.bid_keyword',
      targetId: String(added.id),
      targetLabel: 'iSIGN · 가상 통합인증',
      after: { product: 'iSIGN', keyword: '가상 통합인증', createdBy: ADMIN_EMAIL },
      ip: '198.51.100.8',
    });
  });

  it('삭제: 행 삭제 + 감사 procurement.keyword.delete(삭제 전 값)', async () => {
    state.sessionUserId = adminId;
    const row = await seed('제외', '가상 제외');
    const before = (await audits('procurement.keyword.delete')).length;
    expect(expectOk(await deleteBidKeywordAction({ id: row.id }))).toMatchObject({
      id: row.id,
      keyword: '가상 제외',
    });
    expect(await keywordRows()).toHaveLength(0);
    const log = await audits('procurement.keyword.delete');
    expect(log).toHaveLength(before + 1);
    expect(log.at(-1)).toMatchObject({
      actorUserId: adminId,
      targetId: String(row.id),
      before: { product: '제외', keyword: '가상 제외', createdBy: '기본' },
    });
  });

  it('감사 기록이 실패하면 추가·삭제도 롤백된다 (같은 트랜잭션)', async () => {
    // users 에 없는 actor → audit_logs.actor_user_id FK 위반
    const ghost = {
      access: procurementAccessForTests(
        { id: randomUUID(), email: 'ghost@example.invalid' },
        'write',
      ),
      handle: state.handle!,
      meta: { ip: null, userAgent: null },
    };
    const addsBefore = (await audits('procurement.keyword.add')).length;
    await expect(
      addBidKeyword(ghost, { product: 'WAPPLES', keyword: '롤백 키워드' }),
    ).rejects.toThrow();
    expect(await keywordRows()).toHaveLength(0);
    expect(await audits('procurement.keyword.add')).toHaveLength(addsBefore);

    const row = await seed('WAPPLES', '남아야 할 키워드');
    await expect(deleteBidKeyword(ghost, { id: row.id })).rejects.toThrow();
    expect((await keywordRows()).map((r) => r.keyword)).toEqual(['남아야 할 키워드']);
  });

  it('read 범위 토큰으로는 쓸 수 없다', async () => {
    const ctx = {
      access: procurementAccessForTests({ id: adminId, email: ADMIN_EMAIL }, 'read'),
      handle: state.handle!,
      meta: { ip: null, userAgent: null },
    };
    await expect(addBidKeyword(ctx, { product: 'WAPPLES', keyword: '가상' })).rejects.toThrow(
      'write 범위',
    );
    expect(await keywordRows()).toHaveLength(0);
  });
});

describe('입력 검증', () => {
  it('제어 문자·빈 값·길이 초과·모르는 그룹·잘못된 id → VALIDATION, 변경·감사 없음', async () => {
    state.sessionUserId = adminId;
    const before = (await audits('procurement.keyword.add')).length;
    const control = expectError(
      await addBidKeywordAction({ product: 'WAPPLES', keyword: '가상\u0007키워드' }),
      'VALIDATION',
    );
    expect(control.fieldErrors?.keyword).toEqual([
      '제어 문자나 보이지 않는 문자는 넣을 수 없습니다',
    ]);
    expectError(await addBidKeywordAction({ product: 'WAPPLES', keyword: '   ' }), 'VALIDATION');
    expectError(
      await addBidKeywordAction({ product: 'WAPPLES', keyword: 'x'.repeat(51) }),
      'VALIDATION',
    );
    const group = expectError(
      await addBidKeywordAction({ product: '기타', keyword: '가상' }),
      'VALIDATION',
    );
    expect(group.fieldErrors?.product).toBeDefined();
    expectError(await deleteBidKeywordAction({ id: -1 }), 'VALIDATION');
    expectError(await deleteBidKeywordAction({ id: '1' as unknown as number }), 'VALIDATION');
    expect(await keywordRows()).toHaveLength(0);
    expect(await audits('procurement.keyword.add')).toHaveLength(before);
  });
});

describe('중복·동시 편집 ("이미 처리됨")', () => {
  it('같은 그룹에 이미 있는 키워드 → CONFLICT, 감사 추가 없음. 다른 그룹에는 같은 단어 허용', async () => {
    state.sessionUserId = adminId;
    await seed('WAPPLES', '가상 중복');
    const before = (await audits('procurement.keyword.add')).length;
    const error = expectError(
      await addBidKeywordAction({ product: 'WAPPLES', keyword: ' 가상  중복' }),
      'CONFLICT',
    );
    expect(error.message).toBe('이미 처리됨 — 이미 있는 키워드입니다: 가상 중복');
    expect(await audits('procurement.keyword.add')).toHaveLength(before);
    expectOk(await addBidKeywordAction({ product: '제외', keyword: '가상 중복' }));
    expect(await keywordRows()).toHaveLength(2);
  });

  it("라틴 대소문자 무시: 'WAF' 가 있으면 같은 그룹 'waf' → CONFLICT, 다른 그룹은 허용, 한글은 영향 없음", async () => {
    state.sessionUserId = adminId;
    expectOk(await addBidKeywordAction({ product: 'WAPPLES', keyword: 'WAF' }));
    const error = expectError(
      await addBidKeywordAction({ product: 'WAPPLES', keyword: 'waf' }),
      'CONFLICT',
    );
    expect(error.message).toBe('이미 처리됨 — 이미 있는 키워드입니다: WAF');
    expectOk(await addBidKeywordAction({ product: '제외', keyword: 'waf' }));
    expectOk(await addBidKeywordAction({ product: 'WAPPLES', keyword: '가상방화벽' }));
    expectOk(await addBidKeywordAction({ product: 'WAPPLES', keyword: '가상 방화벽' }));
    expect((await keywordRows()).map((r) => `${r.product}:${r.keyword}`).sort()).toEqual([
      'WAPPLES:WAF',
      'WAPPLES:가상 방화벽',
      'WAPPLES:가상방화벽',
      '제외:waf',
    ]);
  });

  it("'WAF'·'waf' 동시 추가 → 하나만 성공, 다른 쪽은 CONFLICT", async () => {
    state.sessionUserId = adminId;
    const results = await Promise.all([
      addBidKeywordAction({ product: 'D.AMO', keyword: 'WAF' }),
      addBidKeywordAction({ product: 'D.AMO', keyword: 'waf' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error.code === 'CONFLICT')).toHaveLength(1);
    expect(await keywordRows()).toHaveLength(1);
  });

  it('두 관리자가 같은 키워드를 동시에 추가 → 하나만 성공, 다른 쪽은 CONFLICT, 감사 1건', async () => {
    state.sessionUserId = adminId;
    const before = (await audits('procurement.keyword.add')).length;
    const results = await Promise.all([
      addBidKeywordAction({ product: 'D.AMO', keyword: '가상 동시' }),
      addBidKeywordAction({ product: 'D.AMO', keyword: '가상 동시' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error.code === 'CONFLICT')).toHaveLength(1);
    expect(await keywordRows()).toHaveLength(1);
    expect(await audits('procurement.keyword.add')).toHaveLength(before + 1);
  });

  it('이미 삭제된 키워드 삭제 → CONFLICT(이미 처리됨), 감사 1건만', async () => {
    state.sessionUserId = adminId;
    const row = await seed('iSIGN', '가상 삭제');
    const before = (await audits('procurement.keyword.delete')).length;
    const results = await Promise.all([
      deleteBidKeywordAction({ id: row.id }),
      deleteBidKeywordAction({ id: row.id }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const conflict = results.find((r) => !r.ok);
    expect(conflict && !conflict.ok && conflict.error.message).toBe(
      '이미 처리됨 — 이미 삭제된 키워드입니다',
    );
    expect(await audits('procurement.keyword.delete')).toHaveLength(before + 1);
  });
});
