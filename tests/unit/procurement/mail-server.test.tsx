// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import {
  procurementAppState,
  procurementJobRuns,
  procurementMailRecipients,
} from '@/db/schema/procurement';
import type { ActionResult } from '@/lib/result';
import type { SessionUser } from '@/server/auth/session-user';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 수집기 Prami 이전 §3.1 메일 보고 — Server Action·서버 쓰기·상태 카드 조회 (PGlite, 합성 주소만 — example.invalid·example.com).
 * 권한 매트릭스(비로그인·USER·ADMIN·read 토큰), 추가·삭제와 감사(procurement.mail_recipient.add|remove)의 같은 트랜잭션,
 * 앞뒤 공백 제거·형식·대소문자 무시 중복(고유 인덱스 lower(email) 포함)·20개 상한, 이미 삭제됨 CONFLICT,
 * 상태 카드 = 마지막으로 끝난 daily 실행의 summary.mail(4가지 + 모름·형식 어긋남) + 보고 기준일.
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
  currentRequestMeta: async () => ({ ip: '198.51.100.9', userAgent: 'vitest' }),
  currentRequestId: async () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { addMailRecipientAction, removeMailRecipientAction } =
  await import('@/features/procurement/admin/mail/actions');
const { addMailRecipient, removeMailRecipient, getMailReportBoard } =
  await import('@/server/procurement/mail-recipients');
const { MailAdminSection } = await import('@/features/procurement/admin/mail/MailAdminSection');
const { procurementAccessForTests } = await import('@/server/procurement/access-token');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

const ADMIN_EMAIL = 'mail-admin@pentasecurity.com';
const ADD = 'procurement.mail_recipient.add';
const REMOVE = 'procurement.mail_recipient.remove';
let adminId: string;
let userId: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: ADMIN_EMAIL, role: 'ADMIN' })).id;
  userId = (await insertUser(state.handle, { email: 'mail-user@pentasecurity.com', role: 'USER' }))
    .id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(async () => {
  invalidateSessionUser();
  state.sessionUserId = undefined;
  await state.handle!.db.delete(procurementMailRecipients);
  await state.handle!.db.delete(procurementJobRuns);
  await state.handle!.db.delete(procurementAppState);
});

const db = () => state.handle!.db;
const recipientRows = () =>
  db().select().from(procurementMailRecipients).orderBy(procurementMailRecipients.id);
const audits = async (action: string) => auditByAction(state.handle!, action);
const writeAccess = () => procurementAccessForTests({ id: adminId, email: ADMIN_EMAIL }, 'write');

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

async function seed(email: string, createdBy: string | null = 'someone@example.invalid') {
  const [row] = await db()
    .insert(procurementMailRecipients)
    .values({ email, createdBy })
    .returning();
  return row!;
}

describe('권한 매트릭스', () => {
  it('비로그인: 추가·삭제 모두 UNAUTHENTICATED, 변경·감사 없음', async () => {
    const row = await seed('keep@example.invalid');
    expectError(await addMailRecipientAction({ email: 'new@example.invalid' }), 'UNAUTHENTICATED');
    expectError(await removeMailRecipientAction({ id: row.id }), 'UNAUTHENTICATED');
    expect((await recipientRows()).map((r) => r.email)).toEqual(['keep@example.invalid']);
    expect(await audits(ADD)).toHaveLength(0);
  });

  it('USER: FORBIDDEN + 시도한 행위 키로 감사 denied, 변경 없음', async () => {
    state.sessionUserId = userId;
    const row = await seed('keep@example.invalid');
    const before = { add: (await audits(ADD)).length, remove: (await audits(REMOVE)).length };
    expectError(await addMailRecipientAction({ email: 'new@example.invalid' }), 'FORBIDDEN');
    expectError(await removeMailRecipientAction({ id: row.id }), 'FORBIDDEN');
    const add = await audits(ADD);
    const remove = await audits(REMOVE);
    expect(add).toHaveLength(before.add + 1);
    expect(remove).toHaveLength(before.remove + 1);
    for (const denied of [add.at(-1), remove.at(-1)]) {
      expect(denied).toMatchObject({ actorUserId: userId, result: 'denied' });
    }
    expect(add.at(-1)).toMatchObject({ targetId: 'action:addMailRecipient' });
    expect(remove.at(-1)).toMatchObject({ targetId: 'action:removeMailRecipient' });
    expect((await recipientRows()).map((r) => r.email)).toEqual(['keep@example.invalid']);
  });

  it('read 범위 토큰으로는 조회·추가·삭제 모두 거부', async () => {
    const row = await seed('keep@example.invalid');
    const ctx = {
      access: procurementAccessForTests({ id: adminId, email: ADMIN_EMAIL }, 'read'),
      handle: state.handle!,
      meta: { ip: null, userAgent: null },
    };
    await expect(getMailReportBoard(ctx.access, db())).rejects.toThrow('write 범위');
    await expect(addMailRecipient(ctx, { email: 'new@example.invalid' })).rejects.toThrow(
      'write 범위',
    );
    await expect(removeMailRecipient(ctx, { id: row.id })).rejects.toThrow('write 범위');
    expect(await recipientRows()).toHaveLength(1);
  });
});

describe('추가·삭제 + 감사 (같은 트랜잭션, 1건씩)', () => {
  it('추가: 앞뒤 공백 제거한 값 저장(created_by = 관리자 메일) + 감사 add 1건', async () => {
    state.sessionUserId = adminId;
    const before = (await audits(ADD)).length;
    const added = expectOk(await addMailRecipientAction({ email: '  Report@Example.com  ' }));
    expect(added).toMatchObject({ email: 'Report@Example.com', addedBy: 'mail-admin' });
    const [row] = await recipientRows();
    expect(row).toMatchObject({
      id: added.id,
      email: 'Report@Example.com',
      createdBy: ADMIN_EMAIL,
    });
    const log = await audits(ADD);
    expect(log).toHaveLength(before + 1);
    expect(log.at(-1)).toMatchObject({
      actorUserId: adminId,
      actorLabel: ADMIN_EMAIL,
      result: 'success',
      targetType: 'procurement.mail_recipient',
      targetId: String(added.id),
      targetLabel: 'Report@Example.com',
      after: { email: 'Report@Example.com', createdBy: ADMIN_EMAIL },
      ip: '198.51.100.9',
    });
  });

  it('삭제: 행 삭제 + 감사 remove 1건(삭제 전 값)', async () => {
    state.sessionUserId = adminId;
    const row = await seed('gone@example.invalid');
    const before = (await audits(REMOVE)).length;
    expect(expectOk(await removeMailRecipientAction({ id: row.id }))).toMatchObject({
      id: row.id,
      email: 'gone@example.invalid',
      addedBy: 'someone',
    });
    expect(await recipientRows()).toHaveLength(0);
    const log = await audits(REMOVE);
    expect(log).toHaveLength(before + 1);
    expect(log.at(-1)).toMatchObject({
      actorUserId: adminId,
      targetId: String(row.id),
      before: { email: 'gone@example.invalid', createdBy: 'someone@example.invalid' },
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
    const addsBefore = (await audits(ADD)).length;
    await expect(addMailRecipient(ghost, { email: 'rollback@example.invalid' })).rejects.toThrow();
    expect(await recipientRows()).toHaveLength(0);
    expect(await audits(ADD)).toHaveLength(addsBefore);

    const row = await seed('stay@example.invalid');
    await expect(removeMailRecipient(ghost, { id: row.id })).rejects.toThrow();
    expect((await recipientRows()).map((r) => r.email)).toEqual(['stay@example.invalid']);
  });
});

describe('입력 검증 (VALIDATION — 입력칸 아래 email 필드 오류)', () => {
  it('빈 값·형식 오류·잘못된 id → VALIDATION, 변경·감사 없음', async () => {
    state.sessionUserId = adminId;
    const before = (await audits(ADD)).length;
    const blank = expectError(await addMailRecipientAction({ email: '   ' }), 'VALIDATION');
    expect(blank.fieldErrors?.email).toEqual(['메일 주소를 입력하세요']);
    const format = expectError(
      await addMailRecipientAction({ email: 'not-an-address' }),
      'VALIDATION',
    );
    expect(format.fieldErrors?.email?.[0]).toContain('메일 주소 형식이 아닙니다');
    expectError(await addMailRecipientAction({ email: 1 as unknown as string }), 'VALIDATION');
    expectError(await removeMailRecipientAction({ id: -1 }), 'VALIDATION');
    expectError(await removeMailRecipientAction({ id: '1' as unknown as number }), 'VALIDATION');
    expect(await recipientRows()).toHaveLength(0);
    expect(await audits(ADD)).toHaveLength(before);
  });

  it('대소문자 무시 중복 → VALIDATION(기존 주소 안내), 감사 없음', async () => {
    state.sessionUserId = adminId;
    await seed('Ops@Example.invalid');
    const before = (await audits(ADD)).length;
    const error = expectError(
      await addMailRecipientAction({ email: ' ops@example.INVALID ' }),
      'VALIDATION',
    );
    expect(error.fieldErrors?.email).toEqual(['이미 등록된 주소입니다: Ops@Example.invalid']);
    expect(await audits(ADD)).toHaveLength(before);
    expect(await recipientRows()).toHaveLength(1);
  });

  it('고유 인덱스 lower(email): DB 에도 대소문자만 다른 주소는 들어가지 않는다', async () => {
    await seed('Dup@example.invalid');
    await expect(seed('dup@EXAMPLE.invalid')).rejects.toThrow();
    expect(await recipientRows()).toHaveLength(1);
  });

  it('같은 주소(대소문자 다름) 동시 추가 → 하나만 성공, 다른 쪽은 VALIDATION, 감사 1건', async () => {
    state.sessionUserId = adminId;
    const before = (await audits(ADD)).length;
    const results = await Promise.all([
      addMailRecipientAction({ email: 'same@example.invalid' }),
      addMailRecipientAction({ email: 'SAME@example.invalid' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error.code === 'VALIDATION')).toHaveLength(1);
    expect(await recipientRows()).toHaveLength(1);
    expect(await audits(ADD)).toHaveLength(before + 1);
  });

  it('20개면 21번째는 VALIDATION(최대 20개), 하나 지우면 다시 추가된다', async () => {
    state.sessionUserId = adminId;
    for (let i = 0; i < 19; i += 1) await seed(`r${i}@example.com`);
    expectOk(await addMailRecipientAction({ email: 'twentieth@example.com' }));
    const before = (await audits(ADD)).length;
    const error = expectError(
      await addMailRecipientAction({ email: 'over@example.com' }),
      'VALIDATION',
    );
    expect(error.fieldErrors?.email).toEqual(['수신처는 최대 20개까지 등록할 수 있습니다']);
    expect(await recipientRows()).toHaveLength(20);
    expect(await audits(ADD)).toHaveLength(before);
    const [first] = await recipientRows();
    expectOk(await removeMailRecipientAction({ id: first!.id }));
    expectOk(await addMailRecipientAction({ email: 'over@example.com' }));
    expect(await recipientRows()).toHaveLength(20);
  });

  it('19개에서 동시에 2개 추가 → 하나만 성공 (20개 상한 직렬화)', async () => {
    state.sessionUserId = adminId;
    for (let i = 0; i < 19; i += 1) await seed(`r${i}@example.com`);
    const results = await Promise.all([
      addMailRecipientAction({ email: 'a@example.com' }),
      addMailRecipientAction({ email: 'b@example.com' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await recipientRows()).toHaveLength(20);
  });
});

describe('동시 편집 ("이미 처리됨")', () => {
  it('이미 삭제된 수신처 삭제 → CONFLICT, 감사 1건만', async () => {
    state.sessionUserId = adminId;
    const row = await seed('twice@example.invalid');
    const before = (await audits(REMOVE)).length;
    const results = await Promise.all([
      removeMailRecipientAction({ id: row.id }),
      removeMailRecipientAction({ id: row.id }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const conflict = results.find((r) => !r.ok);
    expect(conflict && !conflict.ok && conflict.error.message).toBe(
      '이미 처리됨 — 이미 삭제된 수신처입니다',
    );
    expect(await audits(REMOVE)).toHaveLength(before + 1);
  });
});

describe('상태 카드 (getMailReportBoard)', () => {
  async function runDaily(values: {
    status: 'running' | 'ok' | 'failed';
    startedAt: string;
    finishedAt?: string;
    summary?: Record<string, unknown> | null;
  }) {
    await db()
      .insert(procurementJobRuns)
      .values({
        job: 'daily',
        status: values.status,
        startedAt: new Date(values.startedAt),
        finishedAt: values.finishedAt ? new Date(values.finishedAt) : null,
        summary: values.summary ?? null,
      });
  }

  it('기록이 없으면 lastReport·lastEndDate null, 수신처는 추가 순', async () => {
    await seed('b@example.invalid', null);
    await seed('a@example.invalid');
    const board = await getMailReportBoard(writeAccess(), db());
    expect(board.lastReport).toBeNull();
    expect(board.lastEndDate).toBeNull();
    expect(board.recipients.map(({ email, addedBy }) => ({ email, addedBy }))).toEqual([
      { email: 'b@example.invalid', addedBy: null },
      { email: 'a@example.invalid', addedBy: 'someone' },
    ]);
  });

  it.each([
    [{ mail: 'sent', mail_recipient_count: 3 }, 'sent', 3],
    [{ mail: 'skipped_no_recipients', mail_recipient_count: 0 }, 'skipped_no_recipients', 0],
    [{ mail: 'skipped_no_smtp' }, 'skipped_no_smtp', null],
    [{ mail: 'failed', mail_recipient_count: 2 }, 'failed', 2],
    [{ mail: 'later' }, null, null],
    [{ end_date: '2026-10-27' }, null, null],
    [null, null, null],
  ])('summary %j → outcome %s', async (summary, outcome, recipientCount) => {
    await runDaily({
      status: 'ok',
      startedAt: '2026-10-28T00:00:00Z',
      finishedAt: '2026-10-28T00:20:00Z',
      summary,
    });
    const board = await getMailReportBoard(writeAccess(), db());
    expect(board.lastReport).toEqual({
      outcome,
      recipientCount,
      ranAt: '2026-10-28T00:20:00.000Z',
      runStatus: 'ok',
    });
  });

  it('진행 중 실행·bids 실행은 건너뛰고 마지막으로 끝난 daily 실행을 본다 + 보고 기준일(app_state daily)', async () => {
    await runDaily({
      status: 'ok',
      startedAt: '2026-10-27T00:00:00Z',
      finishedAt: '2026-10-27T00:20:00Z',
      summary: { mail: 'sent', mail_recipient_count: 1 },
    });
    await runDaily({
      status: 'failed',
      startedAt: '2026-10-28T00:00:00Z',
      finishedAt: '2026-10-28T00:05:00Z',
      summary: { mail: 'failed', mail_recipient_count: 4 },
    });
    await runDaily({ status: 'running', startedAt: '2026-10-28T01:00:00Z' });
    await db()
      .insert(procurementJobRuns)
      .values({
        job: 'bids',
        status: 'ok',
        startedAt: new Date('2026-10-28T02:00:00Z'),
        finishedAt: new Date('2026-10-28T02:01:00Z'),
        summary: { mail: 'sent', mail_recipient_count: 9 },
      });
    await db()
      .insert(procurementAppState)
      .values({ key: 'daily', value: { last_end_date: '2026-10-27', last_run: 'x' } });
    const board = await getMailReportBoard(writeAccess(), db());
    expect(board.lastReport).toEqual({
      outcome: 'failed',
      recipientCount: 4,
      ranAt: '2026-10-28T00:05:00.000Z',
      runStatus: 'failed',
    });
    expect(board.lastEndDate).toBe('2026-10-27');
  });

  it('RSC 섹션: 상태 카드 문구·빈 상태를 서버에서 렌더한다', async () => {
    const user = { id: adminId, email: ADMIN_EMAIL, role: 'ADMIN' } as unknown as SessionUser;
    await runDaily({
      status: 'ok',
      startedAt: '2026-10-28T00:00:00Z',
      finishedAt: '2026-10-28T00:20:00Z',
      summary: { mail: 'skipped_no_recipients', mail_recipient_count: 0 },
    });
    const html = renderToStaticMarkup(
      await MailAdminSection({ params: { tab: 'mail' }, access: writeAccess(), user }),
    );
    expect(html).toContain('수신처 없음 — 보내지 않음');
    expect(html).toContain('2026-10-28 09:20 (KST)');
    expect(html).toContain('수신처가 없어 보고 메일을 보내지 않습니다');
    await expect(
      MailAdminSection({ params: {}, access: procurementAccessForTests(), user }),
    ).rejects.toThrow('write 범위');
  });
});
