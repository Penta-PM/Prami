// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type DbHandle } from '@/db';
import { migrateDb } from '@/db/migrate';
import { auditLogs, notices, users } from '@/db/schema';
import {
  SEED_AUDIT_ACTION,
  SEED_NOTICES,
  SEED_USERS,
  SeedTargetError,
  seedDatabase,
  seedTargetViolation,
} from '@/db/seed';

import { countRows } from '../../helpers/db-introspect';

/** AC-02 (PR-1 범위): pnpm seed 후 픽스처 ADMIN·USER 가 users 에 있고 audit_logs 에 user.seed 가 남는다 */
let handle: DbHandle;
/** CI·격리 DB 처럼 seed 를 허용한 환경 (PRAMI-003 §4.9.3 L2) */
const ALLOW = { PRAMI_ALLOW_SEED: '1' };

beforeAll(async () => {
  handle = await createDb({ driver: 'pglite', pgliteDataDir: 'memory://' });
  await migrateDb(handle);
});

afterAll(async () => {
  await handle.close();
});

describe('seedDatabase', () => {
  it('픽스처 ADMIN·USER 각 1명과 공지 샘플, user.seed 감사 로그를 만든다', async () => {
    const result = await seedDatabase(handle, ALLOW);

    expect(result.users.map((u) => u.role).sort()).toEqual(['ADMIN', 'USER']);
    expect(result.noticeCount).toBe(SEED_NOTICES.length);
    expect(result.auditLogCount).toBe(SEED_USERS.length);

    const storedUsers = await handle.db.select().from(users);
    expect(storedUsers).toHaveLength(2);
    expect(storedUsers.every((u) => u.createdVia === 'admin' && u.status === 'active')).toBe(true);

    const seedLogs = await handle.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, SEED_AUDIT_ACTION));
    expect(seedLogs).toHaveLength(2);
    expect(seedLogs.map((l) => l.targetId).sort()).toEqual(storedUsers.map((u) => u.id).sort());
    expect(seedLogs[0]?.actorLabel).toBe('seed');
  });

  it('재실행하면 사용자·공지는 갱신(upsert)되고 감사 로그만 추가된다', async () => {
    await seedDatabase(handle, ALLOW);

    expect(await countRows(handle.db, 'users')).toBe(2);
    expect(await countRows(handle.db, 'notices')).toBe(SEED_NOTICES.length);
    expect(await countRows(handle.db, 'audit_logs')).toBe(SEED_USERS.length * 2);
  });

  it('이메일은 대소문자를 구분하지 않는다 (citext)', async () => {
    const [admin] = await handle.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.email, 'FIXTURE-ADMIN@PENTASECURITY.COM'));
    expect(admin?.email).toBe('fixture-admin@pentasecurity.com');
  });

  it('공지의 작성자는 픽스처 ADMIN 이다', async () => {
    const [admin] = await handle.db.select().from(users).where(eq(users.role, 'ADMIN'));
    const storedNotices = await handle.db.select().from(notices);
    expect(storedNotices.every((n) => n.authorUserId === admin?.id)).toBe(true);
    expect(storedNotices.filter((n) => n.isImportant)).toHaveLength(1);
  });
});

/** 접근하면 기록하는 가짜 DB 핸들 — 거부 경로에서 DB 접근이 0 인지 본다 (AC-323 "쿼리 로거") */
function spyHandle(target: Pick<DbHandle, 'driver' | 'databaseUrl'>) {
  const touched: string[] = [];
  const db = new Proxy(
    {},
    {
      get(_target, property) {
        touched.push(String(property));
        throw new Error('DB 접근 금지');
      },
    },
  );
  return {
    handle: { ...target, db, close: async () => undefined } as unknown as DbHandle,
    touched,
  };
}

describe('seed 대상 가드 (PRAMI-003 §4.3.4·§4.9.3 L2, AC-323·AC-333 ①)', () => {
  const LOCAL_PG = 'postgres://prami:prami@localhost:5432/prami';

  it.each([
    [
      'DB_DRIVER=neon',
      { DB_DRIVER: 'neon', DATABASE_URL: LOCAL_PG, PRAMI_ALLOW_SEED: '1' },
      'neon',
    ],
    ['VERCEL_ENV=preview', { VERCEL_ENV: 'preview', PRAMI_ALLOW_SEED: '1' }, 'vercel'],
    ['NODE_ENV=production', { NODE_ENV: 'production', PRAMI_ALLOW_SEED: '1' }, 'production'],
    [
      'example-remote-host',
      {
        DB_DRIVER: 'pg',
        DATABASE_URL: 'postgres://u:pw@example-remote-host:5432/prami',
        PRAMI_ALLOW_SEED: '1',
      },
      'remote_host',
    ],
    ['로컬인데 PRAMI_ALLOW_SEED 없음', { DB_DRIVER: 'pg', DATABASE_URL: LOCAL_PG }, 'not_allowed'],
    ['PRAMI_ALLOW_SEED=true(1 이 아님)', { PRAMI_ALLOW_SEED: 'true' }, 'not_allowed'],
  ])('%s → 거부(%s), DB 접근 0', async (_name, raw, reason) => {
    const source: Record<string, string | undefined> = raw;
    const target = {
      driver: (source.DB_DRIVER ?? 'pglite') as DbHandle['driver'],
      databaseUrl: source.DATABASE_URL,
    };
    expect(seedTargetViolation(source, target)).toBe(reason);
    const spy = spyHandle(target);
    await expect(seedDatabase(spy.handle, source)).rejects.toBeInstanceOf(SeedTargetError);
    expect(spy.touched).toEqual([]);
  });

  it('로컬 pg·pglite + PRAMI_ALLOW_SEED=1 이면 허용', () => {
    expect(
      seedTargetViolation(
        { DB_DRIVER: 'pg', DATABASE_URL: LOCAL_PG, PRAMI_ALLOW_SEED: '1' },
        { driver: 'pg', databaseUrl: LOCAL_PG },
      ),
    ).toBeNull();
    expect(seedTargetViolation(ALLOW)).toBeNull();
    expect(
      seedTargetViolation({ ...ALLOW, DB_DRIVER: 'pg', DATABASE_URL: 'postgres://u:p@postgres/x' }),
    ).toBeNull();
  });

  it('핸들이 있으면 env 가 아니라 실제 연결을 기준으로 판정한다', () => {
    expect(
      seedTargetViolation(
        { ...ALLOW, DB_DRIVER: 'pg', DATABASE_URL: LOCAL_PG },
        { driver: 'pg', databaseUrl: 'postgres://u:pw@example-remote-host/prami' },
      ),
    ).toBe('remote_host');
  });

  it('기본 source 는 process.env — 단위 테스트 환경에는 PRAMI_ALLOW_SEED 가 없어 거부된다', async () => {
    const spy = spyHandle({ driver: 'pglite', databaseUrl: undefined });
    await expect(seedDatabase(spy.handle)).rejects.toThrowError(/PRAMI_ALLOW_SEED=1/);
    expect(spy.touched).toEqual([]);
  });
});
