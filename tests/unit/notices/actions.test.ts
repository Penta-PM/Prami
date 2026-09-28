// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbHandle } from '@/db';
import { auditLogs, notices } from '@/db/schema';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/**
 * 공지 Server Actions — AC-51 §4.7.1: USER 호출은 FORBIDDEN 봉투(data 없음) + notices 무변경 +
 * 감사 notice.create|update|delete denied 1행(actor = USER) + 부수효과 없음. ADMIN 은 성공 + 감사 success.
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const actions = await import('@/features/notices/actions');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;
let noticeId: string;

const NEW = {
  title: 'USER 가 만들려는 공지',
  authorName: '누군가',
  body: '본문',
  isImportant: false,
};

async function snapshot() {
  const db = state.handle!.db;
  return {
    notices: await db.select().from(notices).orderBy(notices.id),
    audits: await db.$count(auditLogs),
  };
}

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
  const [seeded] = await state.handle.db
    .insert(notices)
    .values({ ...NEW, title: '기존 공지', authorUserId: adminId })
    .returning({ id: notices.id });
  noticeId = seeded!.id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
});

describe('AC-51 USER 거부 (§4.7.1)', () => {
  it.each([
    ['upsertNotice(create)', 'notice.create', () => actions.upsertNoticeAction(NEW)],
    [
      'upsertNotice(update)',
      'notice.update',
      () => actions.upsertNoticeAction({ ...NEW, id: noticeId, title: '변조' }),
    ],
    ['deleteNotice', 'notice.delete', () => actions.deleteNoticeAction({ id: noticeId })],
  ])('%s: FORBIDDEN 봉투 + notices 무변경 + %s denied 1행', async (_name, auditKey, call) => {
    state.sessionUserId = userId;
    const before = await snapshot();
    const result = await call();
    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
    });
    expect('data' in result).toBe(false);
    const after = await snapshot();
    expect(after.notices).toEqual(before.notices);
    expect(after.audits).toBe(before.audits + 1);
    expect((await auditByAction(state.handle!, auditKey)).at(-1)).toMatchObject({
      actorUserId: userId,
      result: 'denied',
      targetId: expect.stringMatching(/^action:(upsertNotice|deleteNotice)$/) as string,
    });
  });

  it('비로그인은 UNAUTHENTICATED', async () => {
    state.sessionUserId = undefined;
    expect(await actions.deleteNoticeAction({ id: noticeId })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});

describe('ADMIN', () => {
  it('등록(검증 오류 → fieldErrors) → 수정 → 삭제, 감사 success', async () => {
    state.sessionUserId = adminId;
    const invalid = await actions.upsertNoticeAction({ ...NEW, title: '' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    if (invalid.ok) throw new Error('unreachable');
    expect(invalid.error.fieldErrors?.title?.[0]).toBe('제목을 입력하세요');

    const created = await actions.upsertNoticeAction({ ...NEW, title: '관리자 공지' });
    expect(created).toMatchObject({ ok: true, data: { title: '관리자 공지' } });
    if (!created.ok) throw new Error('unreachable');
    const updated = await actions.upsertNoticeAction({
      ...NEW,
      id: created.data.id,
      title: '관리자 공지(수정)',
      isImportant: true,
    });
    expect(updated).toMatchObject({ ok: true, data: { id: created.data.id } });
    expect(await actions.deleteNoticeAction({ id: created.data.id })).toMatchObject({
      ok: true,
      data: { id: created.data.id },
    });
    for (const key of ['notice.create', 'notice.update', 'notice.delete']) {
      expect((await auditByAction(state.handle!, key)).at(-1)).toMatchObject({
        actorUserId: adminId,
        result: 'success',
      });
    }
  });
});
