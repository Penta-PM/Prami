// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { DbHandle } from '@/db';
import { users } from '@/db/schema';
import { AppError } from '@/lib/result';

import { auditByAction, createTestDb, insertUser } from '../../helpers/pglite';

/** 2차 방어 (§4.6) + AC-04: USER 가 관리자 Action/Route 를 직접 호출 → FORBIDDEN(403) + 감사 denied */
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
  currentRequestMeta: async () => ({ ip: '198.51.100.4', userAgent: 'vitest' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/env')>()),
  env: { ALLOWED_EMAIL_DOMAINS: ['pentasecurity.com'] },
}));

const rbac = await import('@/server/auth/rbac');
const actions = await import('@/features/users/actions');
const { GET: exportCsv } = await import('@/app/api/audit/export.csv/route');
const { invalidateSessionUser } = await import('@/server/auth/session-user');

let adminId: string;
let userId: string;

beforeAll(async () => {
  state.handle = await createTestDb();
  adminId = (await insertUser(state.handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' }))
    .id;
  userId = (await insertUser(state.handle, { email: 'user@pentasecurity.com', role: 'USER' })).id;
});

afterAll(async () => {
  await state.handle?.close();
});

beforeEach(() => {
  invalidateSessionUser();
  state.sessionUserId = undefined;
});

describe('requirePermission / runAction', () => {
  it('비로그인은 UNAUTHENTICATED', async () => {
    const result = await actions.deactivateUserAction({ id: userId });
    expect(result).toEqual({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다' },
    });
  });

  it('AC-04 (§4.7.1 ①~④): USER 가 updateUser Action 직접 호출 → FORBIDDEN, 대상 무변경, 감사 denied 1행', async () => {
    state.sessionUserId = userId;
    const usersBefore = await state.handle!.db.select().from(users).orderBy(users.id);
    const deniedBefore = (await auditByAction(state.handle!, 'user.update')).length;

    const result = await actions.updateUserAction({
      id: userId,
      name: 'x',
      role: 'ADMIN',
      status: 'active',
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다' },
    });
    expect(await state.handle!.db.select().from(users).orderBy(users.id)).toEqual(usersBefore);
    const denied = await auditByAction(state.handle!, 'user.update');
    expect(denied).toHaveLength(deniedBefore + 1);
    expect(denied.at(-1)).toMatchObject({
      actorUserId: userId,
      targetId: 'action:updateUser',
      result: 'denied',
      ip: '198.51.100.4',
    });
  });

  it('ADMIN 은 Action 을 실행하고 봉투 ok 를 받는다', async () => {
    state.sessionUserId = adminId;
    const created = await actions.createUserAction({
      email: 'pre@pentasecurity.com',
      role: 'USER',
    });
    expect(created).toMatchObject({ ok: true, data: { email: 'pre@pentasecurity.com' } });

    const invalid = await actions.createUserAction({ email: 'bad', role: 'USER' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    if (invalid.ok) throw new Error('unreachable');
    expect(invalid.error.fieldErrors?.email).toBeDefined();
  });
});

describe('runRoute (CSV 내보내기)', () => {
  it('AC-04: USER 는 403 봉투, ADMIN 은 CSV', async () => {
    state.sessionUserId = userId;
    const denied = await exportCsv(new Request('http://localhost/api/audit/export.csv'));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    state.sessionUserId = adminId;
    const ok = await exportCsv(
      new Request('http://localhost/api/audit/export.csv?action=audit.export'),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await ok.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM (엑셀 한글)
    const body = await ok.text();
    expect(body.startsWith('일시,사용자,행위')).toBe(true);
    expect(body).toContain('audit.export');
  });
});

describe('페이지 가드', () => {
  it('requirePagePermission: 비로그인 → /login, USER → 감사 후 /', async () => {
    await expect(rbac.requirePagePermission('audit.read', '/admin/audit')).rejects.toThrow(
      'NEXT_REDIRECT:/login?callbackUrl=%2Fadmin%2Faudit',
    );
    state.sessionUserId = userId;
    await expect(rbac.requirePagePermission('audit.read', '/admin/audit')).rejects.toThrow(
      'NEXT_REDIRECT:/',
    );
    state.sessionUserId = adminId;
    await expect(rbac.requirePagePermission('audit.read', '/admin/audit')).resolves.toMatchObject({
      role: 'ADMIN',
    });
  });

  it('requireAdminArea: USER 는 감사 후 /, ADMIN 은 통과', async () => {
    await expect(rbac.requireAdminArea()).rejects.toThrow('NEXT_REDIRECT:/login');
    state.sessionUserId = userId;
    await expect(rbac.requireAdminArea()).rejects.toThrow('NEXT_REDIRECT:/');
    const denied = await auditByAction(state.handle!, 'auth.access_denied');
    expect(denied.some((log) => log.targetId === '/admin')).toBe(true);
    state.sessionUserId = adminId;
    await expect(rbac.requireAdminArea()).resolves.toMatchObject({ id: adminId });
  });
});

describe('toActionError', () => {
  it('AppError·ZodError·알 수 없는 오류를 봉투로 변환한다 (내부 메시지 비노출)', () => {
    expect(rbac.toActionError(new AppError('CONFLICT', '중복'))).toEqual({
      code: 'CONFLICT',
      message: '중복',
    });
    const zod = z.object({ a: z.string() }).safeParse({});
    expect(rbac.toActionError(zod.error)).toMatchObject({ code: 'VALIDATION' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(rbac.toActionError(new Error('db password=secret'))).toEqual({
      code: 'INTERNAL',
      message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요',
    });
    spy.mockRestore();
  });
});
