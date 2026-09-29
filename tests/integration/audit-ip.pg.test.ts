import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { auditLogs } from '@/db/schema';
import { requestMetaFromHeaders, writeAudit } from '@/server/audit/log';
import { guardTestLogin } from '@/server/auth/test-mode-guard';
import { createRateLimiter } from '@/server/rate-limit';

/**
 * AC-93(로컬 구조)·AC-94 ① — 실제 PostgreSQL 16 에서 위조 X-Forwarded-For 가 audit_logs.ip(inet)에 들어가지 않는지,
 * 신뢰 모드별로 기록되는 IP, 테스트 모드 Host 거부 감사 행을 확인한다. 실제 Vercel 헤더 검증은 11b(D-5).
 */
const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.DB_DRIVER === 'pg' && Boolean(databaseUrl);

describe.skipIf(!enabled)('PostgreSQL 감사 IP 신뢰 헤더·테스트 모드 Host', () => {
  let handle: DbHandle;
  const stamp = `pr11a-${Date.now()}`;
  const forged = new Headers({
    'x-forwarded-for': '1.2.3.4',
    'x-vercel-forwarded-for': '203.0.113.5',
    'x-real-ip': '198.51.100.20',
    'user-agent': 'vitest-integration',
  });

  beforeAll(async () => {
    handle = await createDb({ driver: 'pg', databaseUrl });
    await migrateDb(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  async function recordedIp(mode: 'none' | 'vercel' | 'generic'): Promise<string | null> {
    const targetId = `${stamp}-${mode}`;
    await writeAudit(handle.db, {
      actor: { id: null, label: 'integration' },
      action: 'integration.audit_ip',
      target: { type: 'test', id: targetId },
      meta: requestMetaFromHeaders(forged, mode),
    });
    const [row] = await handle.db
      .select({ ip: auditLogs.ip })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'integration.audit_ip'), eq(auditLogs.targetId, targetId)));
    return row?.ip ?? null;
  }

  it('위조 XFF(1.2.3.4)는 어떤 모드에서도 audit_logs.ip 가 되지 않는다', async () => {
    expect(await recordedIp('none')).toBeNull();
    expect(await recordedIp('vercel')).toBe('203.0.113.5');
    expect(await recordedIp('generic')).toBe('198.51.100.20');
  });

  it('AC-94 ①: 허용 목록 밖 Host 테스트 로그인 → 감사 auth.denied_test_mode (denied, inet NULL)', async () => {
    const email = `${stamp}@pentasecurity.com`;
    const decision = await guardTestLogin({
      db: handle.db,
      host: '192.168.0.10:3000',
      email,
      allowedHosts: ['localhost', '127.0.0.1'],
      limiter: createRateLimiter('integration', 10),
      meta: requestMetaFromHeaders(forged, 'none'),
    });
    expect(decision).toBe('test_mode_host');
    const rows = await handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'auth.denied_test_mode'), eq(auditLogs.actorLabel, email)));
    expect(rows).toEqual([
      expect.objectContaining({ result: 'denied', targetId: '192.168.0.10', ip: null }),
    ]);
  });
});
