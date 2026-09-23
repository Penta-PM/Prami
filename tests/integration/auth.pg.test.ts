import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { auditLogs, users } from '@/db/schema';
import { resolveSignIn } from '@/server/auth/callbacks';
import { updateUser } from '@/server/users/mutations';

/**
 * AC-05·AC-06 — 실제 PostgreSQL 16 (DB_DRIVER=pg). 로그인 판정과 역할 변경 감사가
 * PGlite 와 같은 결과를 내는지 확인한다. DATABASE_URL 이 없으면 스킵.
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);

describe.skipIf(!enabled)('PostgreSQL (DB_DRIVER=pg) 인증·감사', () => {
  let handle: DbHandle;
  const stamp = Date.now();
  const policy = {
    allowedDomains: ['pentasecurity.com'],
    adminEmails: [`boot-${stamp}@pentasecurity.com`],
    autoProvision: true,
  };
  const meta = { ip: '192.0.2.10', userAgent: 'vitest-integration' };

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('부트스트랩 ADMIN·자동 생성 USER·도메인 거부', async () => {
    const admin = await resolveSignIn(
      handle,
      { email: `boot-${stamp}@pentasecurity.com`, emailVerified: true, meta },
      policy,
    );
    expect(admin).toMatchObject({ ok: true, user: { role: 'ADMIN', createdVia: 'bootstrap' } });

    const auto = await resolveSignIn(
      handle,
      { email: `auto-${stamp}@pentasecurity.com`, emailVerified: true, meta },
      policy,
    );
    expect(auto).toMatchObject({ ok: true, user: { role: 'USER', createdVia: 'auto' } });

    const denied = await resolveSignIn(
      handle,
      { email: `x-${stamp}@gmail.com`, emailVerified: true, meta },
      policy,
    );
    expect(denied).toEqual({ ok: false, reason: 'domain' });
  });

  it('역할 변경 감사(before/after·actor·ip)와 audit_logs UPDATE 거부', async () => {
    const [admin] = await handle.db
      .select()
      .from(users)
      .where(eq(users.email, `boot-${stamp}@pentasecurity.com`));
    const [target] = await handle.db
      .select()
      .from(users)
      .where(eq(users.email, `auto-${stamp}@pentasecurity.com`));
    if (!admin || !target) throw new Error('fixture');

    await updateUser(
      {
        handle,
        actor: { id: admin.id, email: admin.email },
        meta,
        allowedDomains: policy.allowedDomains,
      },
      { id: target.id, name: target.name, role: 'ADMIN', status: 'active' },
    );

    const [log] = await handle.db
      .select()
      .from(auditLogs)
      .where(sql`${auditLogs.action} = 'user.update' and ${auditLogs.targetId} = ${target.id}`);
    expect(log).toMatchObject({
      actorUserId: admin.id,
      before: { role: 'USER' },
      after: { role: 'ADMIN' },
      ip: '192.0.2.10',
    });
    await expect(
      handle.db.execute(sql`update audit_logs set reason = 'tamper' where id = ${log?.id}`),
    ).rejects.toThrow();
  });
});
