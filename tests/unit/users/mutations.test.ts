// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '@/db';
import { AppError } from '@/lib/result';
import {
  createUser,
  deactivateUser,
  diffUser,
  updateUser,
  type MutationContext,
} from '@/server/users/mutations';
import { listUsers } from '@/server/users/queries';

import { auditByAction, createTestDb, findUserByEmail, insertUser } from '../../helpers/pglite';

/** 사용자 관리 (§4.5.10) + AC-05 역할 변경 감사 */
let handle: DbHandle;
let ctx: MutationContext;
let adminId: string;

beforeAll(async () => {
  handle = await createTestDb();
  const admin = await insertUser(handle, { email: 'admin@pentasecurity.com', role: 'ADMIN' });
  adminId = admin.id;
  ctx = {
    handle,
    actor: { id: admin.id, email: admin.email },
    meta: { ip: '203.0.113.9', userAgent: 'vitest' },
    allowedDomains: ['pentasecurity.com'],
  };
});

afterAll(async () => {
  await handle.close();
});

const expectAppError = async (promise: Promise<unknown>, code: AppError['code']) => {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
};

describe('diffUser', () => {
  it('바뀐 필드만 before/after 로 돌려주고, 변경이 없으면 null', () => {
    const base = { name: 'a', department: null, role: 'USER', status: 'active' } as const;
    expect(diffUser(base, { ...base, role: 'ADMIN' })).toEqual({
      before: { role: 'USER' },
      after: { role: 'ADMIN' },
    });
    expect(diffUser(base, base)).toBeNull();
  });
});

describe('createUser (이메일 사전 등록)', () => {
  it('created_via=admin 으로 만들고 user.create 감사를 남긴다', async () => {
    const created = await createUser(ctx, {
      email: ' New.Person@PentaSecurity.com ',
      name: '',
      department: '영업팀',
      role: 'ADMIN',
    });
    expect(created).toMatchObject({
      email: 'new.person@pentasecurity.com',
      name: 'new.person',
      department: '영업팀',
      role: 'ADMIN',
      createdVia: 'admin',
      lastLoginAt: null,
    });
    const logs = await auditByAction(handle, 'user.create');
    expect(logs.at(-1)).toMatchObject({ actorUserId: adminId, targetId: created.id });
  });

  it('중복 이메일은 CONFLICT, 허용되지 않은 도메인·형식 오류는 VALIDATION', async () => {
    await expectAppError(
      createUser(ctx, { email: 'new.person@pentasecurity.com', role: 'USER' }),
      'CONFLICT',
    );
    const domain = await expectAppError(
      createUser(ctx, { email: 'x@gmail.com', role: 'USER' }),
      'VALIDATION',
    );
    expect(domain.fieldErrors?.email?.[0]).toContain('pentasecurity.com');
    await expect(createUser(ctx, { email: 'not-an-email', role: 'USER' })).rejects.toThrow();
  });
});

describe('updateUser', () => {
  it('AC-05: 역할 변경 시 before.role·after.role·actor·ip 가 감사 로그에 남는다', async () => {
    const target = await insertUser(handle, { email: 'member@pentasecurity.com', role: 'USER' });

    const updated = await updateUser(ctx, {
      id: target.id,
      name: target.name,
      department: '',
      role: 'ADMIN',
      status: 'active',
    });

    expect(updated.role).toBe('ADMIN');
    const logs = await auditByAction(handle, 'user.update');
    const log = logs.find((entry) => entry.targetId === target.id);
    expect(log).toMatchObject({
      actorUserId: adminId,
      actorLabel: 'admin@pentasecurity.com',
      before: { role: 'USER' },
      after: { role: 'ADMIN' },
      ip: '203.0.113.9',
      result: 'success',
    });
  });

  it('변경이 없으면 감사 로그를 남기지 않는다', async () => {
    const target = await findUserByEmail(handle, 'member@pentasecurity.com');
    if (!target) throw new Error('fixture');
    const before = (await auditByAction(handle, 'user.update')).length;
    await updateUser(ctx, { ...target, department: target.department ?? '' });
    expect(await auditByAction(handle, 'user.update')).toHaveLength(before);
  });

  it('본인의 관리자 권한 해제는 거부한다', async () => {
    const self = await findUserByEmail(handle, 'admin@pentasecurity.com');
    if (!self) throw new Error('fixture');
    await expectAppError(
      updateUser(ctx, { id: self.id, name: self.name, role: 'USER', status: 'active' }),
      'VALIDATION',
    );
  });

  it('없는 사용자는 NOT_FOUND', async () => {
    await expectAppError(
      updateUser(ctx, {
        id: '00000000-0000-4000-8000-000000000000',
        name: 'x',
        role: 'USER',
        status: 'active',
      }),
      'NOT_FOUND',
    );
  });

  it('audit_logs 는 UPDATE 할 수 없다 (append-only 트리거)', async () => {
    await expect(handle.db.execute(sql`update audit_logs set reason = 'tamper'`)).rejects.toThrow();
  });
});

describe('deactivateUser', () => {
  it('status=inactive 로 바꾸고 user.deactivate 감사를 남긴다. 재호출은 변경 없음', async () => {
    const target = await insertUser(handle, { email: 'leaver@pentasecurity.com' });
    const updated = await deactivateUser(ctx, { id: target.id });
    expect(updated.status).toBe('inactive');
    const logs = await auditByAction(handle, 'user.deactivate');
    expect(logs.filter((log) => log.targetId === target.id)).toHaveLength(1);

    await deactivateUser(ctx, { id: target.id });
    expect(
      (await auditByAction(handle, 'user.deactivate')).filter((l) => l.targetId === target.id),
    ).toHaveLength(1);
  });

  it('마지막 활성 관리자는 다른 관리자가 비활성화할 수 없다', async () => {
    const lone = await createTestDb();
    try {
      const adminA = await insertUser(lone, { email: 'a@pentasecurity.com', role: 'ADMIN' });
      const actorB = await insertUser(lone, { email: 'b@pentasecurity.com', role: 'USER' });
      const loneCtx = { ...ctx, handle: lone, actor: { id: actorB.id, email: actorB.email } };
      const error = await expectAppError(deactivateUser(loneCtx, { id: adminA.id }), 'VALIDATION');
      expect(error.message).toContain('마지막 관리자');
    } finally {
      await lone.close();
    }
  });
});

describe('listUsers', () => {
  it('활성 사용자를 먼저, 그 안에서 ADMIN 을 먼저 정렬한다', async () => {
    const rows = await listUsers(handle.db);
    expect(rows.at(-1)?.status).toBe('inactive');
    expect(rows[0]?.role).toBe('ADMIN');
  });
});
